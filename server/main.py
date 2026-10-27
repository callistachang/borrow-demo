"""One process, in-memory sessions, one stick2d request per consumer."""

import asyncio
import secrets
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()
sessions = {}
ROOT = Path(__file__).resolve().parent.parent
HEARTBEAT_TIMEOUT = 15


async def send(socket, message):
    # A disconnected phone must not block everyone else's updates.
    try:
        await asyncio.wait_for(socket.send_json(message), timeout=1)
    except (WebSocketDisconnect, RuntimeError, TimeoutError):
        pass


async def broadcast(room):
    message = {"type": "snapshot", "slots": list(room["slots"].values())}
    for client in room["clients"].values():
        await send(client["socket"], message)


async def neutral(room, slot):
    consumer = room["clients"][slot["id"]]
    await send(consumer["socket"], {"type": "value", "value": {"x": 0, "y": 0}})


def text(value, limit=60):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"Use text between 1 and {limit} characters.")
    return value.strip()


async def handle(room, client_id, message):
    client = room["clients"][client_id]
    kind = message.get("type")

    if kind == "ping":
        await send(client["socket"], {"type": "pong"})
        return

    if kind == "register":
        role = message.get("role")
        if client["role"] is not None or role not in ("consumer", "provider"):
            raise ValueError("Register once, as a consumer or provider.")
        if role == "consumer":
            request = message.get("slot")
            if not isinstance(request, dict) or request.get("capability") != "stick2d":
                raise ValueError("Declare a stick2d request.")
            room["slots"][client_id] = {
                "id": client_id,
                "application": text(message.get("name")),
                "key": text(request.get("key")),
                "label": text(request.get("label"), 160),
                "capability": "stick2d",
                "lender": None,
            }
        client["role"] = role
        await broadcast(room)
        return

    if client["role"] != "provider":
        raise ValueError("Only providers can lend or publish input.")
    slot_id = message.get("slot")
    slot = room["slots"].get(slot_id) if isinstance(slot_id, str) else None
    if slot is None:
        raise ValueError("That request is no longer available.")

    if kind == "claim":
        if slot["lender"] is not None:
            raise ValueError("Someone is already lending here. Wait for them to release.")
        for existing in room["slots"].values():
            if existing["lender"] and existing["lender"]["id"] == client_id:
                raise ValueError("Release your current loan first.")
        slot["lender"] = {"id": client_id, "name": text(message.get("name", "A phone"))}
        await neutral(room, slot)
        await broadcast(room)
        return

    if not slot["lender"] or slot["lender"]["id"] != client_id:
        raise ValueError("You are not lending to this request.")
    if kind == "release":
        slot["lender"] = None
        await neutral(room, slot)
        await broadcast(room)
    elif kind == "value":
        value = message.get("value")
        if not isinstance(value, dict):
            raise ValueError("Send x and y values.")
        for axis in ("x", "y"):
            number = value.get(axis)
            if type(number) not in (int, float) or not -1 <= number <= 1:
                raise ValueError("x and y must be numbers between -1 and 1.")
        consumer = room["clients"][slot_id]
        await send(consumer["socket"], {"type": "value", "value": {"x": value["x"], "y": value["y"]}})
    else:
        raise ValueError("Unknown message type.")


@app.post("/api/sessions", status_code=201)
async def create_session():
    session = secrets.token_urlsafe(12)
    sessions[session] = {"clients": {}, "slots": {}, "lock": asyncio.Lock()}
    return {"session": session, "projector": f"/session/{session}"}


@app.get("/api/sessions/{session}")
async def session_info(session: str):
    return {"exists": session in sessions}


@app.websocket("/ws/{session}")
async def websocket_endpoint(socket: WebSocket, session: str):
    await socket.accept()
    if session not in sessions:
        await send(socket, {"type": "error", "message": "Session ended. Scan a new QR code."})
        await socket.close()
        return

    room = sessions[session]
    client_id = secrets.token_urlsafe(8)
    async with room["lock"]:
        room["clients"][client_id] = {"socket": socket, "role": None}
        await send(socket, {"type": "hello", "id": client_id})
    try:
        while True:
            # Browsers send a ping every four seconds, even when nobody is touching.
            message = await asyncio.wait_for(socket.receive_json(), HEARTBEAT_TIMEOUT)
            async with room["lock"]:
                try:
                    if not isinstance(message, dict):
                        raise ValueError("Send a JSON object.")
                    await handle(room, client_id, message)
                except ValueError as error:
                    await send(socket, {"type": "error", "message": str(error)})
    except (WebSocketDisconnect, TimeoutError, ValueError):
        pass
    finally:
        async with room["lock"]:
            del room["clients"][client_id]
            room["slots"].pop(client_id, None)
            for slot in room["slots"].values():
                if slot["lender"] and slot["lender"]["id"] == client_id:
                    slot["lender"] = None
                    await neutral(room, slot)
            await broadcast(room)
        try:
            await socket.close()
        except RuntimeError:
            pass


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
@app.get("/session/{session}")
async def projector():
    return FileResponse(ROOT / "web" / "index.html")


@app.get("/join/{session}")
async def phone():
    return FileResponse(ROOT / "providers" / "phone" / "index.html")


# npm installs these browser scripts; only these two files are served.
@app.get("/lib/p5.js")
async def p5_library():
    return FileResponse(ROOT / "node_modules" / "p5" / "lib" / "p5.min.js")


@app.get("/lib/qrcode.js")
async def qr_library():
    return FileResponse(ROOT / "node_modules" / "qrcode-generator" / "qrcode.js")


app.mount("/assets", StaticFiles(directory=ROOT / "web"))
app.mount("/sdk", StaticFiles(directory=ROOT / "sdk" / "js"))
app.mount("/providers", StaticFiles(directory=ROOT / "providers"))
app.mount("/examples", StaticFiles(directory=ROOT / "examples", html=True))
