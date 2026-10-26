"""Local COSMIC session checkpoints; invoked by the graphical login service."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
import logging
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time

import yaml
from cosmic_wm_manager.config.schema import ProfileConfig
from cosmic_wm_manager.persistence.session import SessionManager

HOME = Path.home()
ROOT = HOME / '.config/cosmic-wm-manager'
LATEST = ROOT / 'sessions/auto-latest.yaml'
HISTORY = ROOT / 'history'
STATUS = ROOT / 'auto-status.json'
SEED = ROOT / 'sessions/initial.yaml'
CLI = HOME / '.cargo/bin/cos-cli'
WM = HOME / '.local/bin/cosmic-wm'
RESTORE_WINDOW_TIMEOUT = 90
STOP = threading.Event()
LOG = logging.getLogger('desktop-watch')


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def state():
    result = subprocess.run([str(CLI), 'info', '--json'], capture_output=True,
                            text=True, check=True, timeout=8)
    raw = json.loads(result.stdout)
    if not raw.get('outputs') or not raw.get('workspace_groups'):
        raise ValueError('Compositor topology is not ready')
    return raw


def session_token():
    runtime = Path(os.environ['XDG_RUNTIME_DIR'])
    display = runtime / os.environ['WAYLAND_DISPLAY']
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip() + ':' + str(display.stat().st_ino)


def stopping():
    active = subprocess.run(['systemctl', '--user', 'is-active', '--quiet',
                             'graphical-session.target'], timeout=3).returncode == 0
    result = subprocess.run(['busctl', 'get-property', 'org.freedesktop.login1',
                             '/org/freedesktop/login1', 'org.freedesktop.login1.Manager',
                             'PreparingForShutdown'], capture_output=True, text=True, timeout=3)
    # If logind cannot be checked, preserve the previous snapshot.
    return STOP.is_set() or not active or result.returncode != 0 or result.stdout.strip() != 'b false'


def read_profile(path):
    data = yaml.safe_load(path.read_text())
    ProfileConfig.model_validate(data)
    return data


def make_profile(raw, catalog):
    groups = raw['workspace_groups']
    monitors, offsets = [], {}
    total = 0
    for group in groups:
        outputs = group.get('outputs', [])
        if len(outputs) != 1:
            raise ValueError('Ambiguous workspace-to-output mapping; preserving previous snapshot')
        output = outputs[0]
        count = max(int(ws['name']) for ws in group['workspaces'])
        offsets[output] = total
        monitors.append(dict(output=output, primary=not monitors, workspace_count=count))
        total += count

    windows = [win for win in raw['apps'] if win.get('app_id') and not win['app_id'].startswith('cosmic-')]
    if not windows:
        raise ValueError('Empty desktop; preserving previous snapshot')
    counts = Counter(win['app_id'] for win in windows)
    commands = {item['match']['class']: item['command'] for item in catalog['apps']}
    resolver = SessionManager.__new__(SessionManager)
    apps = []
    for win in windows:
        appid = win['app_id']
        command = commands.get(appid) or resolver._find_command_from_desktop_file(appid)
        if not command and shutil.which(appid):
            command = shlex.quote(shutil.which(appid))
        if not command:
            raise ValueError(f'No reviewed launcher for {appid}; preserving previous snapshot')
        outputs, spaces = win.get('outputs', []), win.get('workspaces', [])
        if len(outputs) != 1 or len(spaces) != 1:
            raise ValueError(f'Ambiguous window placement for {appid}')
        output = outputs[0]['name']
        match = {'class': appid}
        if counts[appid] > 1 and win.get('title'):
            match['title'] = re.escape(win['title'])
        apps.append(dict(command=command, workspace=offsets[output] + int(spaces[0]['workspace']), match=match))
    # Sorting ignores changes in compositor enumeration and focus.
    apps.sort(key=lambda app: (app['match']['class'], app['workspace'], app['match'].get('title', '')))
    profile = dict(name='auto-latest', description='Automatic desktop checkpoint', monitors=monitors, apps=apps)
    ProfileConfig.model_validate(profile)
    return profile


def checkpoint(profile, latest=LATEST, history=HISTORY):
    content = yaml.safe_dump(profile, allow_unicode=True, sort_keys=False).encode()
    if latest.exists() and yaml.safe_load(latest.read_text()) == profile:
        return False
    history.mkdir(parents=True, exist_ok=True, mode=0o700)
    if latest.exists():
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        atomic_write(history / (stamp + '.yaml'), latest.read_bytes())
    atomic_write(latest, content)
    for old in sorted(history.glob('*.yaml'))[:-10]:
        old.unlink()
    return True


def write_status(phase, **extra):
    data = dict(phase=phase, updated_at=datetime.now(timezone.utc).isoformat(), **extra)
    atomic_write(STATUS, json.dumps(data, indent=2).encode())


def placements(profile):
    cfg = ProfileConfig.model_validate(profile)
    return Counter((app.match.app_id, *cfg.resolve_workspace_output(app.workspace)) for app in cfg.apps)


def actual_placements(raw):
    return Counter((win['app_id'], win['outputs'][0]['name'], int(win['workspaces'][0]['workspace']))
                   for win in raw['apps'] if len(win.get('outputs', [])) == 1 and len(win.get('workspaces', [])) == 1)



def reconcile_placements(profile, timeout=30):
    """Repair late startup moves using fresh indices; never launch applications.

    CLI success only confirms a request was sent. Splash windows may disappear,
    shifting enumeration indices, and apps may move themselves after mapping.
    Keep correctly placed windows and move only surplus windows to missing slots.
    Ambiguous same-app destinations are left for manual review.
    """
    expected = placements(profile)
    deadline = time.monotonic() + timeout
    while not stopping():
        raw = state()
        actual = actual_placements(raw)
        missing = expected - actual
        if not missing:
            return
        if time.monotonic() >= deadline:
            break
        surplus = actual - expected
        moved = False
        for (appid, output, workspace), count in missing.items():
            destinations = {(o, w) for (a, o, w) in missing if a == appid}
            if len(destinations) != 1:
                continue
            candidates = [win for win in raw['apps']
                          if win['app_id'] == appid
                          and len(win.get('outputs', [])) == 1
                          and len(win.get('workspaces', [])) == 1
                          and surplus[(appid, win['outputs'][0]['name'],
                                       int(win['workspaces'][0]['workspace']))] > 0]
            if not candidates:
                continue
            group = next((g for g in raw['workspace_groups'] if output in g['outputs']), None)
            out = next((o for o in raw['outputs'] if o['name'] == output), None)
            target = next((w for w in group['workspaces'] if int(w['name']) == workspace), None) if group else None
            if target is None or out is None:
                continue
            win = candidates[0]
            subprocess.run([str(CLI), 'move', '-i', str(win['index']),
                            '-w', str(target['index']), '-g', str(group['index']),
                            '-o', str(out['index'])], capture_output=True, check=True, timeout=8)
            LOG.info('Rechecked placement: %s -> %s workspace %s', appid, output, workspace)
            moved = True
            break  # Refresh indices and counts after every move.
        if not moved:
            break
        STOP.wait(.5)
    raise RuntimeError(f'Restore incomplete: {dict(expected - actual)}; automatic saving remains stopped')


def restore(profile):
    expected_outputs = {mon['output'] for mon in profile['monitors']}
    deadline = time.monotonic() + 90
    ready_since = None
    while time.monotonic() < deadline and not STOP.is_set():
        try:
            raw = state()
            if expected_outputs <= {out['name'] for out in raw['outputs']}:
                ready_since = ready_since or time.monotonic()
                if time.monotonic() - ready_since >= 10:
                    break
            else:
                ready_since = None
        except Exception:
            ready_since = None
        STOP.wait(2)
    else:
        raise RuntimeError('Desktop/expected monitors not ready; saved checkpoint retained')
    if stopping():
        raise RuntimeError('Session is stopping; restore cancelled')
    # Cold-starting LibreOffice after boot took about 34 seconds on Desktop-2023.
    # Keep the poll timeout above that observed startup time so a healthy, slow
    # application does not disable checkpointing for the whole login session.
    process = subprocess.Popen(
        [str(WM), 'restore', 'auto-latest', '--timeout', str(RESTORE_WINDOW_TIMEOUT)],
        start_new_session=True,
    )
    deadline = time.monotonic() + 180
    try:
        while process.poll() is None:
            if STOP.wait(.2) or time.monotonic() >= deadline:
                raise RuntimeError('Restore interrupted; saved checkpoint retained')
        if process.returncode:
            raise RuntimeError(f'Restore command exited {process.returncode}')
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    reconcile_placements(profile)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture-once', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    ROOT.mkdir(parents=True, exist_ok=True)
    lockpath = Path(os.environ['XDG_RUNTIME_DIR']) / 'cosmic-desktop-watch.lock'
    with lockpath.open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        seed = read_profile(SEED)
        if args.capture_once:
            if stopping():
                raise RuntimeError('Not saving a session during shutdown')
            profile = make_profile(state(), seed)
            checkpoint(profile)
            write_status('seeded', window_count=len(profile['apps']))
            LOG.info('Saved initial checkpoint: %d windows', len(profile['apps']))
            return
        signal.signal(signal.SIGTERM, lambda *_: STOP.set())
        signal.signal(signal.SIGINT, lambda *_: STOP.set())
        marker = Path(os.environ['XDG_RUNTIME_DIR']) / 'cosmic-desktop-watch.restored'
        token = session_token()
        if LATEST.exists() and (not marker.exists() or marker.read_text() != token):
            profile = read_profile(LATEST)
            write_status('restoring', window_count=len(profile['apps']))
            try:
                restore(profile)
            except Exception as error:
                write_status('restore-failed', error=str(error))
                raise
            atomic_write(marker, token.encode())
            LOG.info('Restored checkpoint and verified placements')
        elif not LATEST.exists():
            raise RuntimeError('Initial checkpoint missing; capture once before starting')
        write_status('watching', interval_seconds=30, window_count=len(read_profile(LATEST)['apps']))
        LOG.info('Watching every 30 seconds; retaining 10 previous checkpoints')
        while not STOP.wait(30):
            try:
                if stopping():
                    LOG.info('Session stopping; retaining last checkpoint')
                    break
                previous = read_profile(LATEST)
                raw = state()
                expected_outputs = {mon['output'] for mon in previous['monitors']}
                if not expected_outputs <= {out['name'] for out in raw['outputs']}:
                    raise ValueError('Saved monitor disconnected; preserving previous checkpoint')
                profile = make_profile(raw, seed)
                # Recheck shutdown after capture, before committing.
                if stopping():
                    break
                changed = checkpoint(profile)
                write_status('watching', interval_seconds=30, changed=changed, window_count=len(profile['apps']))
                if changed:
                    LOG.info('Updated checkpoint: %d windows', len(profile['apps']))
            except Exception as error:
                write_status('capture-skipped', error=str(error))
                LOG.warning('Checkpoint skipped: %s', error)


if __name__ == '__main__':
    main()
