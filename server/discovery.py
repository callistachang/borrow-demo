"""Find Borrow endpoints on one LAN; discovery never creates a binding."""

import asyncio
import logging
from dataclasses import asdict, dataclass
from ipaddress import IPv4Address
from uuid import uuid4

from zeroconf import IPVersion, ServiceInfo, ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf

SERVICE_TYPE = "_borrow._tcp.local."
# This describes the existing browser endpoint, NOT the future /peer protocol.
PROTOCOL = "borrow-browser-v0"
logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class Endpoint:
    node_id: str
    name: str
    addresses: list[str]
    port: int
    protocol: str
    ws_path: str

    def snapshot(self):
        return {**asdict(self), "urls": [
            f"ws://{address}:{self.port}{self.ws_path}" for address in self.addresses
        ]}


class Discovery:
    def __init__(self, address: str | None = None, *, name: str = "Borrow",
                 port: int | None = None, on_change=None):
        self.address = address
        self.node_id = uuid4().hex  # Identity of this running instance, not saved bindings.
        self.name = name
        self.port = port
        self.on_change = on_change
        self.endpoints: dict[str, Endpoint] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._zc = None
        self._browser = None
        self._info = None

    def local_snapshot(self):
        if self.port is None:
            return None
        return Endpoint(self.node_id, self.name, [self.address], self.port,
                        PROTOCOL, "/ws").snapshot()

    def snapshot(self):
        return [endpoint.snapshot() for _, endpoint in sorted(self.endpoints.items())]

    async def start(self):
        self._zc = AsyncZeroconf(
            **({"interfaces": [self.address]} if self.address else {}),
            ip_version=IPVersion.V4Only,
        )
        try:
            if self.port is not None:
                self._info = ServiceInfo(
                    SERVICE_TYPE, f"{self.name}.{SERVICE_TYPE}",
                    addresses=[IPv4Address(self.address).packed], port=self.port,
                    server=f"borrow-{self.node_id}.local.",
                    properties={"node_id": self.node_id, "protocol": PROTOCOL,
                                "ws_path": "/ws"},
                )
                sent = await self._zc.async_register_service(self._info, allow_name_change=True)
                await sent
                self.name = self._info.get_name()
                logger.info("Borrow advertising %s at %s:%s", self.name, self.address, self.port)
            self._browser = AsyncServiceBrowser(
                self._zc.zeroconf, SERVICE_TYPE, handlers=[self._changed],
            )
        except BaseException:
            await self.close()
            raise

    def _changed(self, zeroconf, service_type, name, state_change):
        # A newer event supersedes an in-flight lookup. In particular, a late
        # lookup must never re-add a service after its goodbye was received.
        previous = self._tasks.pop(name, None)
        if previous:
            previous.cancel()
        if state_change is ServiceStateChange.Removed:
            self._remove(name)
        else:
            self._tasks[name] = asyncio.create_task(self._resolve(name))

    def _remove(self, name):
        endpoint = self.endpoints.pop(name, None)
        if endpoint:
            self._emit("LEFT", endpoint)

    def _emit(self, event, endpoint):
        logger.info("Borrow %s: %s at %s:%s", event, endpoint.name,
                    ", ".join(endpoint.addresses), endpoint.port)
        if self.on_change:
            self.on_change(event, endpoint.snapshot())

    async def _resolve(self, name):
        try:
            info = AsyncServiceInfo(SERVICE_TYPE, name)
            if not await info.async_request(self._zc.zeroconf, 3000):
                self._remove(name)
                logger.warning("Borrow lookup timed out: %s", name)
                return
            props = info.decoded_properties
            node_id = props.get("node_id")
            if (props.get("protocol") != PROTOCOL or props.get("ws_path") != "/ws"
                    or not node_id or len(node_id) > 128 or node_id == self.node_id):
                self._remove(name)
                return
            addresses = sorted(info.parsed_addresses(IPVersion.V4Only))
            if not addresses or not info.port:
                self._remove(name)
                return
            endpoint = Endpoint(node_id, info.get_name(), addresses, info.port, PROTOCOL, "/ws")
            old = self.endpoints.get(name)
            self.endpoints[name] = endpoint
            if old != endpoint:
                self._emit("FOUND" if old is None else "UPDATED", endpoint)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._remove(name)
            logger.exception("Borrow could not resolve %s", name)
        finally:
            if self._tasks.get(name) is asyncio.current_task():
                del self._tasks[name]

    async def close(self):
        if self._browser:
            await self._browser.async_cancel()
            self._browser = None
        tasks = list(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._zc:
            try:
                if self._info:
                    sent = await self._zc.async_unregister_service(self._info)
                    await sent
            finally:
                await self._zc.async_close()
                self._zc = None
                self._info = None
        self.endpoints.clear()
