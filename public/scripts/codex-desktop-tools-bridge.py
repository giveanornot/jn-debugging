#!/usr/bin/env python3
"""Connect the shared app-server to the installed Desktop's official MCP bridge."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import stat
import sys
import time


RESOURCES = Path('/opt/codex-desktop/resources')
PLUGIN = RESOURCES / 'plugins/openai-bundled/plugins/codex-app-tools'
PIPE_ENV = 'CODEX_APP_TOOLS_PIPE_PATH'


def desktop_bridge():
    """Use only this user's installed Desktop app-server and owned live socket."""
    candidates = {}
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            if (proc / 'exe').resolve(strict=True) != RESOURCES / 'codex':
                continue
            if b'app-server' not in (proc / 'cmdline').read_bytes().split(b'\0'):
                continue
            values = dict(item.split(b'=', 1) for item in
                          (proc / 'environ').read_bytes().split(b'\0') if b'=' in item)
            pipe = Path(os.fsdecode(values[PIPE_ENV.encode()]))
            info = pipe.stat()
            if not pipe.is_absolute() or not stat.S_ISSOCK(info.st_mode):
                continue
            if info.st_uid != os.getuid():
                continue
            candidates[str(pipe)] = int(proc.name)
        except (OSError, KeyError, ValueError):
            continue
    if not candidates:
        raise RuntimeError('No running Codex Desktop app-tools bridge; open Codex Desktop first.')
    if len(candidates) != 1:
        raise RuntimeError('Multiple Desktop app-tools bridges found; refusing an ambiguous connection.')
    pipe, pid = next(iter(candidates.items()))
    return {'pipe': pipe, 'desktop_server_pid': pid, 'plugin': str(PLUGIN)}


async def refresh():
    # This runs alongside GUI startup. Wait for its native bridge, then use the
    # supported reload API so existing shared threads pick up the new socket.
    from websockets.asyncio.client import unix_connect
    deadline = time.monotonic() + 60
    while True:
        try:
            bridge = desktop_bridge()
            break
        except RuntimeError:
            if time.monotonic() >= deadline:
                raise
            await asyncio.sleep(1)
    codex_home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    socket = codex_home / 'app-server-control/app-server-control.sock'
    async with unix_connect(str(socket), uri='ws://localhost/rpc', open_timeout=5) as ws:
        async def request(i, method, params):
            await ws.send(json.dumps({'id': i, 'method': method, 'params': params}))
            while True:
                message = json.loads(await asyncio.wait_for(ws.recv(), 20))
                if message.get('id') == i:
                    if 'error' in message:
                        raise RuntimeError(json.dumps(message['error']))
                    return message.get('result')
        await request(1, 'initialize', {
            'clientInfo': {'name': 'codex_shared_desktop_bridge', 'version': '1'},
            'capabilities': {'experimentalApi': True},
        })
        await ws.send(json.dumps({'method': 'initialized'}))
        await request(2, 'config/mcpServer/reload', {})
    print(json.dumps({'mcp_reload_queued': True, **bridge}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    if args.refresh:
        asyncio.run(refresh())
        return
    bridge = desktop_bridge()
    if args.check:
        print(json.dumps(bridge))
        return
    launcher = PLUGIN / 'scripts/launch_codex_app_tools_mcp'
    server = PLUGIN / 'server.mjs'
    if not launcher.is_file() or not server.is_file():
        raise RuntimeError('Installed official Codex app-tools MCP files are missing.')
    os.environ[PIPE_ENV] = bridge['pipe']
    os.environ['CODEX_CLI_PATH'] = str(RESOURCES / 'codex')
    os.environ['CODEX_ELECTRON_RESOURCES_PATH'] = str(RESOURCES)
    os.execv(str(launcher), [str(launcher), str(server)])


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, TimeoutError) as error:
        print(f'Codex shared Desktop tools: {error}', file=sys.stderr)
        raise SystemExit(1)
