import asyncio
import math
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()
ROOT = Path(__file__).resolve().parent.parent

Kind = Literal["axis1d", "button"]
KINDS = {"axis1d", "button"}


@dataclass
class Host:
    id: str
    name: str
    ws: WebSocket
    cap_reqs: dict[str, Kind] = field(default_factory=dict)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class Provider:
    id: str
    name: str
    ws: WebSocket
    caps: dict[str, Kind] = field(default_factory=dict)
    values: dict[str, float | bool] = field(default_factory=dict)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


Peer = Host | Provider
hosts: dict[str, Host] = {}
providers: dict[str, Provider] = {}
bindings: dict[tuple[str, str], tuple[str, str]] = {}
# (host_id, slot) -> (provider_id, capability)


def required_string(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Expected nonempty string")
    return value.strip()


def default(kind: Kind) -> float | bool:
    return False if kind == "button" else 0.0


def checked_value(kind: Kind, value: object) -> float | bool:
    if kind == "button":
        if type(value) is not bool:
            raise ValueError("Button value must be true or false")
        return value
    if type(value) not in (int, float) or not math.isfinite(
        value  # ty: ignore[invalid-argument-type]
    ):
        raise ValueError("Axis value must be a finite number")
    return max(-1.0, min(1.0, float(value)))  # ty: ignore[invalid-argument-type]


def snapshot() -> dict:
    return {
        "op": "state",
        "hosts": [
            {"id": host.id, "name": host.name, "slots": host.cap_reqs}
            for host in hosts.values()
        ],
        "providers": [
            {
                "id": provider.id,
                "name": provider.name,
                "capabilities": provider.caps,
            }
            for provider in providers.values()
        ],
        "bindings": [
            {
                "host": host_id,
                "slot": slot,
                "provider": provider_id,
                "capability": capability,
            }
            for (host_id, slot), (provider_id, capability) in bindings.items()
        ],
    }


async def send(peer: Peer, message: dict):
    # Broadcasts and value updates can arrive concurrently.
    async with peer.send_lock:
        await peer.ws.send_json(message)


async def try_send(peer: Peer, message: dict):
    try:
        await send(peer, message)
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass  # The socket's handler will remove it when disconnected.


async def broadcast():
    state = snapshot()
    await asyncio.gather(
        *(try_send(peer, state) for peer in [*hosts.values(), *providers.values()])
    )


def make_binding(actor: Peer, message: dict):
    host_id = required_string(message.get("host"))
    provider_id = required_string(message.get("provider"))
    slot = required_string(message.get("slot"))
    capability = required_string(message.get("capability"))

    host = hosts.get(host_id)
    provider = providers.get(provider_id)
    if host is None or provider is None:
        raise ValueError("Unknown host or provider")
    if actor.id not in (host_id, provider_id):
        raise ValueError("Only the host or provider may request a binding")
    if slot not in host.cap_reqs or capability not in provider.caps:
        raise ValueError("Unknown slot or capability")
    if host.cap_reqs[slot] != provider.caps[capability]:
        raise ValueError("Capability types do not match")

    target = (host_id, slot)
    source = (provider_id, capability)
    if target in bindings and bindings[target] != source:
        raise ValueError("Slot is occupied")
    if source in bindings.values() and bindings.get(target) != source:
        raise ValueError("Capability is already bound")

    bindings[target] = source
    return host, slot, provider.values[capability]


async def handle(peer: Peer, message: dict):
    op = message.get("op")

    if op == "declare":
        name = required_string(message.get("name"))
        kind = message.get("kind")
        if kind not in KINDS:
            raise ValueError("Kind must be axis1d or button")
        declarations = peer.cap_reqs if isinstance(peer, Host) else peer.caps
        if name in declarations and declarations[name] != kind:
            raise ValueError("Cannot change a declared capability type")
        declarations[name] = kind
        if isinstance(peer, Provider):
            peer.values.setdefault(name, default(kind))
        await broadcast()

    # Request a snapshot of the current Borrow-Server state
    elif op == "list":
        await send(peer, snapshot())

    elif op == "bind":
        host, slot, value = make_binding(peer, message)
        await broadcast()
        await try_send(host, {"op": "input", "slot": slot, "value": value})

    elif op == "unbind":
        if not isinstance(peer, Host):
            raise ValueError("Only hosts can unbind")
        slot = required_string(message.get("slot"))
        if (peer.id, slot) in bindings:
            del bindings[(peer.id, slot)]
            await try_send(
                peer,
                {"op": "input", "slot": slot, "value": default(peer.cap_reqs[slot])},
            )
            await broadcast()

    elif op == "value":
        if not isinstance(peer, Provider):
            raise ValueError("Only providers can send values")
        capability = required_string(message.get("capability"))
        if capability not in peer.caps:
            raise ValueError("Unknown capability")
        value = checked_value(peer.caps[capability], message.get("value"))
        peer.values[capability] = value
        for (host_id, slot), source in list(bindings.items()):
            if source == (peer.id, capability) and host_id in hosts:
                await try_send(
                    hosts[host_id], {"op": "input", "slot": slot, "value": value}
                )

    else:
        raise ValueError("Unknown operation")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    peer: Peer | None = None

    try:
        hello = await ws.receive_json()
        if not isinstance(hello, dict) or hello.get("op") != "hello":
            await ws.close(code=1008)
            return
        role = hello.get("role")
        if role not in ("host", "provider"):
            await ws.close(code=1008)
            return
        name = required_string(hello.get("name"))
        peer_id = secrets.token_urlsafe(8)
        peer = (
            Host(peer_id, name, ws) if role == "host" else Provider(peer_id, name, ws)
        )

        await send(peer, {"op": "welcome", "id": peer_id})
        if isinstance(peer, Host):
            hosts[peer_id] = peer
        else:
            providers[peer_id] = peer
        await broadcast()

        while True:
            message = await ws.receive_json()
            try:
                if not isinstance(message, dict):
                    raise ValueError("Expected JSON object")
                await handle(peer, message)
            except (ValueError, TypeError) as exc:
                await send(peer, {"op": "error", "message": str(exc)})

    except (WebSocketDisconnect, RuntimeError, OSError, ValueError, TypeError):
        pass

    finally:
        if peer is not None:
            if isinstance(peer, Host):
                hosts.pop(peer.id, None)
            else:
                providers.pop(peer.id, None)

            vacated = [
                (host_id, slot)
                for (host_id, slot), (provider_id, _) in bindings.items()
                if host_id == peer.id or provider_id == peer.id
            ]
            for target in vacated:
                if bindings.pop(target, None) is None:
                    continue
                # Since the provider disconnected, return host input to default value.
                if target[0] in hosts:
                    host = hosts[target[0]]
                    await try_send(
                        host,
                        {
                            "op": "input",
                            "slot": target[1],
                            "value": default(host.cap_reqs[target[1]]),
                        },
                    )
            await broadcast()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/hosts/{host_id}")
def host_info(host_id: str):
    host = hosts.get(host_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host unavailable. Scan a new QR code.")
    return {"id": host.id, "name": host.name}


@app.get("/join/{host_id}")
def phone(host_id: str):
    return FileResponse(ROOT / "providers/phone/index.html")


@app.get("/sdk/borrow.js")
def browser_sdk():
    return FileResponse(ROOT / "sdk/js/index.js", media_type="text/javascript")


@app.get("/lib/qrcode.mjs")
def qr_library():
    return FileResponse(
        ROOT / "sdk/js/node_modules/qrcode-generator/dist/qrcode.mjs",
        media_type="text/javascript",
    )


app.mount("/providers/phone", StaticFiles(directory=ROOT / "providers/phone"))
