"""Run from server/: uv run python borrow.py --help."""

import argparse
import asyncio
from ipaddress import IPv4Address
import json
import socket

import uvicorn

from discovery import Discovery


def lan_address(value):
    try:
        address = IPv4Address(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use this computer's Wi-Fi/Ethernet IPv4 address") from exc
    if address.is_unspecified or address.is_loopback or address.is_multicast or int(address) == 0xffffffff:
        raise argparse.ArgumentTypeError("Use a LAN address, not localhost, 0.0.0.0, or multicast")
    return str(address)


def port_number(value):
    port = int(value)
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("Port must be between 1 and 65535")
    return port


async def browse(address):
    discovery = Discovery(address, on_change=lambda event, endpoint: print(
        f"{event} {json.dumps(endpoint)}", flush=True))
    try:
        await discovery.start()
        print("Looking for Borrow instances. Ctrl+C to stop.", flush=True)
        await asyncio.Event().wait()
    finally:
        await discovery.close()


def main():
    parser = argparse.ArgumentParser(description="Borrow LAN discovery (no cross-node routing yet)")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="Run Borrow and advertise its real endpoint")
    serve.add_argument("--address", required=True, type=lan_address,
                       help="This computer's LAN IPv4 address; also selects the discovery interface")
    serve.add_argument("--port", type=port_number, default=8000)
    serve.add_argument("--name", default="Borrow", help="Friendly name (at most 63 UTF-8 bytes)")
    watch = commands.add_parser("browse", help="Watch nearby Borrow instances, without starting a server")
    watch.add_argument("--address", type=lan_address, help="This computer's LAN IPv4 address (otherwise all interfaces)")
    args = parser.parse_args()
    if args.command == "browse":
        try:
            asyncio.run(browse(args.address))
        except KeyboardInterrupt:
            pass
        return
    if not args.name.strip() or len(args.name.encode("utf-8")) > 63:
        parser.error("--name must contain 1–63 UTF-8 bytes and cannot be blank")

    from main import app

    app.state.discovery = Discovery(args.address, name=args.name, port=args.port)
    # Bind before advertising: reject incorrect interface addresses and busy
    # ports without publishing an endpoint that cannot start. Listen on the
    # selected LAN address, so local browsers should use that address too.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind((args.address, args.port))
        except OSError as exc:
            parser.error(f"Cannot listen at {args.address}:{args.port}: {exc}")
        listener.listen(128)
        config = uvicorn.Config(app, host=args.address, port=args.port, workers=1)
        try:
            uvicorn.Server(config).run(sockets=[listener])
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
