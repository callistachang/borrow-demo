"""Run with: uv run --with httpx python -m unittest discover -s tests"""

import unittest
from contextlib import contextmanager
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from main import app, sessions


def until(socket, kind, predicate=lambda message: True):
    while True:
        message = socket.receive_json()
        if message["type"] == kind and predicate(message):
            return message


class RelayTests(unittest.TestCase):
    def setUp(self):
        sessions.clear()
        self.client = self.enterContext(TestClient(app))
        self.session = self.client.post("/api/sessions").json()["session"]

    @contextmanager
    def peer(self, role, session=None, name="Test sketch"):
        with self.client.websocket_connect(f"/ws/{session or self.session}") as socket:
            identity = socket.receive_json()["id"]
            socket.send_json({"type": "register", "role": role, "name": name,
                              "slot": {"key": "movement", "label": "Move something", "capability": "stick2d"}})
            until(socket, "snapshot")
            yield socket, identity

    def test_lending_values_release_and_new_lender(self):
        with self.peer("consumer") as (sketch, slot), self.peer("provider") as (alice, _), self.peer("provider") as (bob, _):
            alice.send_json({"type": "claim", "slot": slot, "name": "Alice"})
            until(alice, "snapshot", lambda m: m["slots"][0]["lender"] is not None)
            bob.send_json({"type": "claim", "slot": slot})
            self.assertIn("already lending", until(bob, "error")["message"])
            bob.send_json({"type": "value", "slot": slot, "value": {"x": 1, "y": 0}})
            self.assertIn("not lending", until(bob, "error")["message"])
            bob.send_json({"type": "release", "slot": slot})
            self.assertIn("not lending", until(bob, "error")["message"])
            alice.send_json({"type": "value", "slot": slot, "value": {"x": 0.7, "y": -0.4}})
            until(sketch, "value", lambda m: m["value"] == {"x": 0.7, "y": -0.4})
            for value in ({"x": 2, "y": 0}, {"x": True, "y": 0}, {"x": float("nan"), "y": 0}):
                alice.send_json({"type": "value", "slot": slot, "value": value})
                self.assertIn("between -1 and 1", until(alice, "error")["message"])
            alice.send_json({"type": "release", "slot": slot})
            self.assertEqual(until(sketch, "value")["value"], {"x": 0, "y": 0})
            bob.send_json({"type": "claim", "slot": slot, "name": "Bob"})
            until(bob, "snapshot", lambda m: m["slots"][0]["lender"] and m["slots"][0]["lender"]["name"] == "Bob")

    def test_reuse_exclusive_loan_and_disconnect_cleanup(self):
        with self.peer("consumer", name="First") as (first, a), self.peer("consumer", name="New unrelated sketch") as (second, b):
            with self.peer("provider") as (phone, _):
                phone.send_json({"type": "claim", "slot": a})
                until(first, "value")
                phone.send_json({"type": "claim", "slot": b})
                self.assertIn("Release your current", until(phone, "error")["message"])
                phone.send_json({"type": "release", "slot": a})
                until(first, "value")
                phone.send_json({"type": "claim", "slot": b})
                until(second, "value")
                phone.send_json({"type": "value", "slot": b, "value": {"x": 1, "y": 1}})
                until(second, "value", lambda m: m["value"]["x"] == 1)
            self.assertEqual(until(second, "value")["value"], {"x": 0, "y": 0})
            until(second, "snapshot", lambda m: all(s["lender"] is None for s in m["slots"]))

    def test_session_isolation_and_expired_session(self):
        other = self.client.post("/api/sessions").json()["session"]
        with self.peer("consumer") as (_, slot), self.peer("provider", session=other) as (phone, _):
            phone.send_json({"type": "claim", "slot": slot})
            self.assertIn("no longer available", until(phone, "error")["message"])
        with self.client.websocket_connect("/ws/missing") as socket:
            self.assertIn("Session ended", socket.receive_json()["message"])

    def test_silent_connection_times_out(self):
        with patch("main.HEARTBEAT_TIMEOUT", 0.05):
            with self.peer("provider") as (phone, identity):
                with self.assertRaises(WebSocketDisconnect):
                    phone.receive_json()
                self.assertNotIn(identity, sessions[self.session]["clients"])

    def test_static_pages_and_sdk_are_served(self):
        for path in ("/", "/join/demo", "/sdk/index.js", "/examples/garden/", "/examples/ribbon/", "/lib/p5.js", "/lib/qrcode.js"):
            self.assertEqual(self.client.get(path).status_code, 200, path)
