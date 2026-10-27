/**
 * Borrow browser SDK v0.
 *
 * Host:     createHost('Kinetic Ribbon').axis2d('bend').value
 * Provider: createProvider('My Phone').axis1d('tilt_x').set(0.5)
 *
 * No build step. Import this ES module from the Borrow relay's /sdk/borrow.js.
 */

function relayURL() {
  // When the SDK is served from the relay, the sketch need not configure a URL.
  const url = new URL("/ws", import.meta.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function baseURL(wsURL) {
  const url = new URL(wsURL);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function checkName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Borrow names must be nonempty strings");
  }
  return name.trim();
}

function checkValue(kind, value) {
  if (kind === "button") {
    if (typeof value !== "boolean")
      throw new TypeError("Button expects a boolean");
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("axis1d expects a finite number");
  }
  return Math.max(-1, Math.min(1, value));
}

function neutral(kind) {
  return kind === "button" ? false : 0;
}

class Connection {
  constructor(role, name, { url } = {}) {
    this.role = role;
    this.name = checkName(name);
    this.url = url ?? relayURL();
    this.id = null;
    this.state = { op: "state", hosts: [], providers: [], bindings: [] };
    this.status = "connecting";
    this._declarations = new Map();
    this._listeners = new Set();
    this._errorListeners = new Set();
    this._socket = new WebSocket(this.url);

    this._socket.addEventListener("open", () => {
      this._send({ op: "hello", role, name: this.name });
    });
    this._socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.op === "welcome") {
        this.id = message.id;
        this.status = "connected";
        for (const [name, kind] of this._declarations) {
          this._send({ op: "declare", name, kind });
        }
        this._afterWelcome();
        this._emit();
      } else if (message.op === "state") {
        this.state = message;
        this._onState();
        this._emit();
      } else if (message.op === "input") {
        this._onInput(message);
      } else if (message.op === "error") {
        for (const listener of this._errorListeners) listener(message.message);
        console.warn("[Borrow]", message.message);
      }
    });
    this._socket.addEventListener("close", () => {
      this.status = "disconnected";
      this.id = null;
      this._onClose();
      this._emit();
    });
  }

  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  onError(listener) {
    this._errorListeners.add(listener);
    return () => this._errorListeners.delete(listener);
  }

  _emit() {
    for (const listener of this._listeners) listener(this.state);
  }

  _send(message) {
    if (this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(message));
    }
  }

  _declare(name, kind) {
    name = checkName(name);
    if (this._declarations.has(name))
      throw new Error(`Duplicate Borrow input: ${name}`);
    this._declarations.set(name, kind);
    // Declarations made before welcome are sent together after it arrives.
    if (this.id) this._send({ op: "declare", name, kind });
    this._emit();
    return name;
  }

  _afterWelcome() {}
  _onState() {}
  _onInput() {}
  _onClose() {}

  destroy() {
    this._socket.close();
  }
}

class Host extends Connection {
  constructor(name, options = {}) {
    super("host", name, options);
    this._inputs = new Map();
    if (options.panel !== false && typeof document !== "undefined") {
      this._mountPanel();
    }
  }

  axis1d(name) {
    return this._input(name, "axis1d");
  }

  button(name) {
    const input = this._input(name, "button");
    const callbacks = new Set();
    input.onPress = (callback) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    };
    input._pressCallbacks = callbacks;
    return input;
  }

  axis2d(name) {
    name = checkName(name);
    const x = this.axis1d(`${name}.x`);
    const y = this.axis1d(`${name}.y`);
    return {
      get value() {
        return { x: x.value, y: y.value };
      },
      x,
      y,
    };
  }

  _input(name, kind) {
    name = this._declare(name, kind);
    const input = { value: neutral(kind), kind };
    this._inputs.set(name, input);
    this._emit(); // Also update the panel if a slot is added after connection.
    return input;
  }

  _onInput({ slot, value }) {
    const input = this._inputs.get(slot);
    if (!input) return;
    const previous = input.value;
    input.value = value;
    if (input.kind === "button" && !previous && value === true) {
      for (const callback of input._pressCallbacks) callback();
    }
  }

  _onState() {
    // A binding is the authority for occupancy. When it disappears, neutralize.
    if (!this.id) return;
    const occupied = new Set(
      this.state.bindings.filter((b) => b.host === this.id).map((b) => b.slot),
    );
    for (const [slot, input] of this._inputs) {
      if (!occupied.has(slot)) input.value = neutral(input.kind);
    }
  }

  _onClose() {
    for (const input of this._inputs.values())
      input.value = neutral(input.kind);
  }

  get joinURL() {
    if (!this.id) return null;
    return new URL(`/join/${encodeURIComponent(this.id)}`, baseURL(this.url))
      .href;
  }

  bind(slot, provider, capability) {
    if (!this.id) return;
    this._send({ op: "bind", host: this.id, slot, provider, capability });
  }

  unbind(slot) {
    if (!this.id) return;
    this._send({ op: "unbind", slot });
  }

  _mountPanel() {
    const mount = () => {
      if (this._panel) return;
      injectStyles();
      const root = document.createElement("details");
      root.className = "borrow-panel";
      const summary = document.createElement("summary");
      const body = document.createElement("div");
      body.className = "borrow-body";
      root.append(summary, body);
      document.body.append(root);
      this._panel = root;
      this._panelSummary = summary;
      this._panelBody = body;
      this.onChange(() => this._renderPanel());
      this._renderPanel();
    };
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  _renderPanel() {
    if (!this._panel) return;
    const bindings = this.id
      ? this.state.bindings.filter((b) => b.host === this.id)
      : [];
    this._panelSummary.textContent = `Borrow · ${this.name} (${bindings.length}/${this._inputs.size})`;
    const body = this._panelBody;
    body.replaceChildren();
    const status = el("div", `Server: ${this.status}`, "borrow-muted");
    body.append(status);

    for (const [slot, input] of this._inputs) {
      const binding = bindings.find((b) => b.slot === slot);
      const row = el("div", "", "borrow-slot");
      const heading = el("div", `${slot} [${input.kind}]`, "borrow-slot-name");
      row.append(heading);
      if (binding) {
        const provider = this.state.providers.find(
          (p) => p.id === binding.provider,
        );
        row.append(
          el(
            "div",
            `← ${provider?.name ?? binding.provider} / ${binding.capability}`,
            "borrow-muted",
          ),
        );
        const button = el("button", "Disconnect");
        button.addEventListener("click", () => this.unbind(slot));
        row.append(button);
      } else {
        row.append(el("div", "Empty", "borrow-muted"));
        const choices = [];
        const occupied = new Set(
          this.state.bindings.map((b) => `${b.provider}/${b.capability}`),
        );
        for (const provider of this.state.providers) {
          for (const [capability, kind] of Object.entries(
            provider.capabilities,
          )) {
            if (
              kind === input.kind &&
              !occupied.has(`${provider.id}/${capability}`)
            ) {
              choices.push({ provider, capability });
            }
          }
        }
        if (choices.length) {
          const select = document.createElement("select");
          for (const [index, choice] of choices.entries()) {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = `${choice.provider.name} / ${choice.capability}`;
            select.append(option);
          }
          const button = el("button", "Bind");
          button.addEventListener("click", () => {
            const choice = choices[Number(select.value)];
            if (choice) this.bind(slot, choice.provider.id, choice.capability);
          });
          row.append(select, button);
        } else {
          row.append(
            el("div", "No available compatible devices", "borrow-muted"),
          );
        }
      }
      body.append(row);
    }

    if (this.joinURL) {
      const section = el("div", "", "borrow-join");
      const image = document.createElement("img");
      image.src = new URL(
        `/qr/${encodeURIComponent(this.id)}`,
        baseURL(this.url),
      ).href;
      image.alt = "QR code for connecting a phone";
      image.width = 136;
      image.height = 136;
      const link = el("a", "Join with phone");
      link.href = this.joinURL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      section.append(image, link);
      body.append(section);
    }
  }

  destroy() {
    super.destroy();
    this._panel?.remove();
  }
}

class Provider extends Connection {
  constructor(name, options = {}) {
    super("provider", name, options);
    this._values = new Map();
  }

  axis1d(name) {
    return this._output(name, "axis1d");
  }
  button(name) {
    return this._output(name, "button");
  }

  _output(name, kind) {
    name = this._declare(name, kind);
    const output = {
      value: neutral(kind),
      set: (value) => {
        output.value = checkValue(kind, value);
        this._values.set(name, output.value);
        if (this.id)
          this._send({ op: "value", capability: name, value: output.value });
      },
    };
    this._values.set(name, output.value);
    return output;
  }

  _afterWelcome() {
    // Declarations are sent before values, in socket order.
    for (const [capability, value] of this._values) {
      this._send({ op: "value", capability, value });
    }
  }

  bind(host, slot, capability) {
    if (!this.id) return;
    this._send({ op: "bind", host, slot, provider: this.id, capability });
  }
}

function el(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function injectStyles() {
  if (document.getElementById("borrow-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "borrow-panel-styles";
  style.textContent = `
.borrow-panel { position:fixed;right:14px;top:14px;width:min(340px,calc(100vw - 28px));z-index:99999;
  color:#e9eef7;background:#192232f2;border:1px solid #627087;border-radius:10px;
  font:13px system-ui,sans-serif;box-shadow:0 8px 24px #0006; }
.borrow-panel summary {cursor:pointer;padding:12px;font-weight:650;}
.borrow-body {padding:0 12px 12px;max-height:75vh;overflow:auto;}
.borrow-muted {color:#aebbcf;font-size:12px;margin:4px 0;overflow-wrap:anywhere;}
.borrow-slot {border-top:1px solid #485669;padding:10px 0;}
.borrow-slot-name {font-weight:650;}
.borrow-panel button,.borrow-panel select {background:#30445f;color:#fff;border:1px solid #60758e;
  border-radius:6px;padding:6px;margin:5px 5px 0 0;max-width:100%;cursor:pointer;}
.borrow-panel select {max-width:210px;}
.borrow-join {border-top:1px solid #485669;padding-top:12px;display:flex;align-items:center;gap:16px;}
.borrow-join img {background:#fff;padding:5px;border-radius:6px;box-sizing:content-box;}
.borrow-join a {color:#b1ddff;}
`;
  document.head.append(style);
}

export function createHost(name, options = {}) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const url = options.url ?? `${protocol}://${location.hostname}:8000/ws`;

  return new Host(name, { ...options, url });
}

export function createProvider(name, options) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const url = options.url ?? `${protocol}://${location.hostname}:8000/ws`;
  return new Provider(name, { ...options, url });
}
