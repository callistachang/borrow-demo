import { createProvider } from "/sdk/borrow.js";

const hostId = decodeURIComponent(location.pathname.split("/")[2]);
const target = document.getElementById("target");
const name = document.getElementById("name");
const share = document.getElementById("share");
const status = document.getElementById("status");
const feedback = document.getElementById("feedback");
const controls = document.getElementById("controls");
const pad = document.getElementById("touchpad");
const puck = document.getElementById("puck");
const press = document.getElementById("press");
name.value = `Phone ${Math.random().toString(36).slice(2, 6)}`;

let available = false;
let device = null;
let padPointer = null;
let buttonPointer = null;
let timer = null;
let lastSent = 0;
let position = { x: 0, y: 0 };

function render() {
  const connected = device?.provider.status === "connected";
  share.disabled = !available && !device;
  share.textContent = device ? "Stop sharing" : "Start sharing";
  name.disabled = Boolean(device);
  controls.hidden = !connected;
  status.textContent = connected
    ? "Sharing. Assign this device’s controls on the laptop."
    : device ? "Connecting…" : "Not sharing.";
}

function sendPosition() {
  clearTimeout(timer);
  timer = null;
  if (!device) return;
  device.x.set(position.x);
  device.y.set(position.y);
  lastSent = performance.now();
}

function move(x, y, immediate = false) {
  position = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  puck.style.left = `${50 + position.x * 40}%`;
  puck.style.top = `${50 - position.y * 40}%`;
  if (!device) return;
  const delay = Math.max(0, 1000 / 30 - (performance.now() - lastSent));
  if (immediate || delay === 0) sendPosition();
  else if (timer === null) timer = setTimeout(sendPosition, delay);
}

function setPressed(value) {
  press.dataset.pressed = String(value);
  device?.button.set(value);
}

function resetPad() {
  const pointer = padPointer;
  padPointer = null;
  if (pointer !== null && pad.hasPointerCapture(pointer)) pad.releasePointerCapture(pointer);
  move(0, 0, true);
}

function resetButton() {
  const pointer = buttonPointer;
  buttonPointer = null;
  if (pointer !== null && press.hasPointerCapture(pointer)) press.releasePointerCapture(pointer);
  setPressed(false);
}

function reset() {
  resetPad();
  resetButton();
}

function stopSharing() {
  reset();
  clearTimeout(timer);
  timer = null;
  const previous = device;
  device = null;
  previous?.provider.destroy();
  render();
}

share.addEventListener("click", () => {
  if (device) {
    stopSharing();
    return;
  }
  feedback.textContent = "";
  const provider = createProvider(name.value.trim() || "A phone");
  device = {
    provider,
    x: provider.axis1d("touchpad.x"),
    y: provider.axis1d("touchpad.y"),
    button: provider.button("button"),
  };
  provider.onError((message) => { feedback.textContent = message; });
  provider.onChange((state) => {
    if (device?.provider !== provider) return;
    if (provider.status === "disconnected") {
      stopSharing();
      feedback.textContent = "Connection lost. Tap Start sharing to try again.";
      return;
    }
    // Welcome arrives before the first snapshot. Wait for our provider to appear.
    if (state.providers.some((peer) => peer.id === provider.id)
        && !state.hosts.some((host) => host.id === hostId)) {
      available = false;
      target.textContent = "Application unavailable. Scan a new QR code on the laptop.";
      stopSharing();
      return;
    }
    render();
  });
  render();
});

try {
  const response = await fetch(`/api/hosts/${encodeURIComponent(hostId)}`);
  if (response.status === 404) {
    target.textContent = "Application unavailable. Scan a new QR code on the laptop.";
  } else {
    if (!response.ok) throw new Error("Could not reach the application. Reload to try again.");
    const host = await response.json();
    target.textContent = `Share controls for ${host.name}`;
    available = true;
  }
} catch (error) {
  target.textContent = "Could not connect.";
  feedback.textContent = error.message;
}
render();

function drag(event) {
  const bounds = pad.getBoundingClientRect();
  move((event.clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.4),
    -(event.clientY - bounds.top - bounds.height / 2) / (bounds.height * 0.4));
}

pad.addEventListener("pointerdown", (event) => {
  if (!device || padPointer !== null || event.button !== 0) return;
  padPointer = event.pointerId;
  pad.setPointerCapture(padPointer);
  drag(event);
});
pad.addEventListener("pointermove", (event) => {
  if (event.pointerId === padPointer) drag(event);
});
press.addEventListener("pointerdown", (event) => {
  if (!device || buttonPointer !== null || event.button !== 0) return;
  buttonPointer = event.pointerId;
  press.setPointerCapture(buttonPointer);
  setPressed(true);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  pad.addEventListener(type, (event) => { if (event.pointerId === padPointer) resetPad(); });
  press.addEventListener(type, (event) => { if (event.pointerId === buttonPointer) resetButton(); });
}
press.addEventListener("contextmenu", (event) => event.preventDefault());
const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
pad.addEventListener("keydown", (event) => {
  if (device && arrows[event.key]) {
    event.preventDefault();
    move(...arrows[event.key]);
  }
});
pad.addEventListener("keyup", (event) => { if (arrows[event.key]) resetPad(); });
press.addEventListener("keydown", (event) => {
  if (device && [" ", "Enter"].includes(event.key)) {
    event.preventDefault();
    if (!event.repeat) setPressed(true);
  }
});
press.addEventListener("keyup", (event) => {
  if ([" ", "Enter"].includes(event.key)) {
    event.preventDefault();
    resetButton();
  }
});
pad.addEventListener("blur", resetPad);
press.addEventListener("blur", resetButton);
addEventListener("blur", reset);
addEventListener("pagehide", stopSharing);
document.addEventListener("visibilitychange", () => { if (document.hidden) stopSharing(); });
