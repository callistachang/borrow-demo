// Both phones and sketches use this same small WebSocket connection.
// onMessage is an ordinary function, called whenever something arrives.
export function connect(session, registration, onMessage, { relay = location.origin } = {}) {
  const endpoint = new URL(`/ws/${encodeURIComponent(session)}`, relay);
  if (!["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol)) {
    throw new Error("Use an HTTP(S) or WebSocket relay URL.");
  }
  endpoint.protocol = ["https:", "wss:"].includes(endpoint.protocol) ? "wss:" : "ws:";
  const socket = new WebSocket(endpoint.href);
  let lastMessage = Date.now();
  let closed = false;

  function send(message) {
    if (!closed && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    socket.close();
    onMessage({ type: "disconnected" });
  }

  // Detect a vanished connection even if the browser doesn't report it promptly.
  const heartbeat = setInterval(() => {
    if (Date.now() - lastMessage > 12000) close();
    else send({ type: "ping" });
  }, 4000);

  socket.onopen = () => send({ type: "register", ...registration });
  socket.onmessage = event => {
    if (closed) return;
    lastMessage = Date.now();
    onMessage(JSON.parse(event.data));
  };
  socket.onclose = close;
  socket.onerror = close;
  addEventListener("pagehide", close, { once: true });
  return { send, close };
}

// MVP: one input per sketch. The returned input is updated as messages arrive.
export function createBorrow({ session, name, relay }) {
  let input;
  let clientId;
  const borrow = {
    status: "Not connected",
    onChange: () => {},
    stick2d(key, { label }) {
      if (input) throw new Error("This MVP supports one input per sketch.");
      input = { key, label, capability: "stick2d", value: { x: 0, y: 0 }, lender: null };
      return input;
    },
    connect() {
      connect(session, { role: "consumer", name, slot: input }, message => {
        if (message.type === "hello") {
          clientId = message.id;
          borrow.status = "Connected";
        }
        if (message.type === "snapshot") {
          const slot = message.slots.find(slot => slot.id === clientId);
          input.lender = slot ? slot.lender : null;
          if (!input.lender) input.value = { x: 0, y: 0 };
        }
        if (message.type === "value") input.value = message.value;
        if (message.type === "error") borrow.status = message.message;
        if (message.type === "disconnected") {
          input.value = { x: 0, y: 0 };
          input.lender = null;
          if (borrow.status === "Connected") borrow.status = "Disconnected. Reload to reconnect.";
        }
        borrow.onChange();
      }, { relay });
    },
  };
  return borrow;
}
