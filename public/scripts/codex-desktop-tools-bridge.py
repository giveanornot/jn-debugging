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
    # With WebSocket transport, Desktop may have no local stdio app-server.
    # In that case verify the socket is actually held by the Desktop executable.
    native_sockets = {}
    for line in Path('/proc/net/unix').read_text().splitlines()[1:]:
        fields = line.split(maxsplit=7)
        if len(fields) == 8:
            path = Path(fields[7])
            if path.parent.name == 'codex-app-tools' and path.suffix == '.sock':
                native_sockets[fields[6]] = path

    def add(pipe, pid):
        info = pipe.stat()
        if pipe.is_absolute() and stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid():
            candidates[str(pipe)] = pid

    for proc in Path('/proc').glob('[0-9]*'):
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            executable = (proc / 'exe').resolve(strict=True)
            if executable == RESOURCES.parent / 'ChatGPT':
                for fd in (proc / 'fd').iterdir():
                    try:
                        target = os.readlink(fd)
                        if target.startswith('socket:['):
                            pipe = native_sockets.get(target[8:-1])
                            if pipe is not None:
                                add(pipe, int(proc.name))
                    except OSError:
                        continue
                continue
            if executable != RESOURCES / 'codex':
                continue
            if b'app-server' not in (proc / 'cmdline').read_bytes().split(b'\0'):
                continue
            values = dict(item.split(b'=', 1) for item in
                          (proc / 'environ').read_bytes().split(b'\0') if b'=' in item)
            pipe = Path(os.fsdecode(values[PIPE_ENV.encode()]))
            add(pipe, int(proc.name))
        except (OSError, KeyError, ValueError):
            continue
    if not candidates:
        raise RuntimeError('No running Codex Desktop app-tools bridge; open Codex Desktop first.')
    if len(candidates) != 1:
        raise RuntimeError('Multiple Desktop app-tools bridges found; refusing an ambiguous connection.')
    pipe, pid = next(iter(candidates.items()))
    return {'pipe': pipe, 'desktop_server_pid': pid, 'plugin': str(PLUGIN)}


async def probe_tools(bridge):
    """Wait for real tool discovery, not just a listening Desktop pipe."""
    env = dict(os.environ)
    env[PIPE_ENV] = bridge['pipe']
    env['CODEX_CLI_PATH'] = str(RESOURCES / 'codex')
    env['CODEX_ELECTRON_RESOURCES_PATH'] = str(RESOURCES)
    proc = await asyncio.create_subprocess_exec(
        str(PLUGIN / 'scripts/launch_codex_app_tools_mcp'), str(PLUGIN / 'server.mjs'),
        env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=1024 * 1024,
    )
    async def request(i, method, params):
        proc.stdin.write((json.dumps({'jsonrpc': '2.0', 'id': i,
                                     'method': method, 'params': params}) + '\n').encode())
        await proc.stdin.drain()
        while True:
            line = await asyncio.wait_for(proc.stdout.readline(), 8)
            if not line:
                raise RuntimeError('Desktop MCP readiness probe exited')
            response = json.loads(line)
            if response.get('id') == i:
                if 'error' in response:
                    raise RuntimeError('Desktop renderer is not ready for tools/list')
                return response['result']
    try:
        await request(1, 'initialize', {
            'protocolVersion': '2024-11-05', 'capabilities': {},
            'clientInfo': {'name': 'desktop_tools_readiness', 'version': '1'},
        })
        proc.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        await proc.stdin.drain()
        result = await request(2, 'tools/list', {})
        if not result.get('tools'):
            raise RuntimeError('Desktop renderer tool catalog is empty')
        return len(result['tools'])
    finally:
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 2)
            except TimeoutError:
                proc.kill()
                await proc.wait()


async def refresh():
    # This runs alongside GUI startup. Wait for its native bridge, then use the
    # supported reload API so existing shared threads pick up the new socket.
    from websockets.asyncio.client import unix_connect
    deadline = time.monotonic() + 60
    while True:
        try:
            bridge = desktop_bridge()
            tool_count = await probe_tools(bridge)
            break
        except (OSError, RuntimeError, TimeoutError):
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
    print(json.dumps({'mcp_reload_queued': True, 'readiness_tool_count': tool_count, **bridge}))


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
