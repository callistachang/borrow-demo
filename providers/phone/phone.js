import { connect } from "/sdk/index.js";

const requests = document.getElementById("requests");
const control = document.getElementById("control");
const touchpad = document.getElementById("touchpad");
const feedback = document.getElementById("feedback");
let clientId;
let slots = [];
let loan = null;
let connected = false;
let pointer = null;

const session = location.pathname.split("/")[2];
let connection;
if (!session) {
  document.getElementById("welcome").hidden = false;
  const start = document.getElementById("start");
  start.onclick = async () => {
    start.disabled = true;
    try {
      const response = await fetch("/api/sessions", { method: "POST" });
      if (!response.ok) throw new Error("Could not create a session. Try again.");
      location.href = (await response.json()).join;
    } catch (error) {
      feedback.textContent = error.message;
      start.disabled = false;
    }
  };
} else {
  document.getElementById("connection").textContent = "Connecting…";
  document.getElementById("browse").hidden = false;
  const joinURL = `${location.origin}/join/${encodeURIComponent(session)}`;
  const qr = qrcode(0, "M");
  qr.addData(joinURL);
  qr.make();
  document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  document.getElementById("join-link").href = joinURL;
  document.getElementById("session-id").textContent = session;
  document.getElementById("relay-url").textContent = location.origin;
  document.getElementById("share").hidden = false;
  connection = connect(session, { role: "provider" }, message => {
    if (message.type === "hello") {
      clientId = message.id;
      connected = true;
      document.getElementById("connection").textContent = "Connected";
    }
    if (message.type === "snapshot") slots = message.slots;
    if (message.type === "error") feedback.textContent = message.message;
    if (message.type === "disconnected") {
      connected = false;
      slots = [];
      document.getElementById("connection").textContent = "Disconnected. Reload to reconnect.";
    }
    if (message.type !== "pong") render();
  });
}

function render() {
  loan = slots.find(slot => slot.lender && slot.lender.id === clientId);
  document.getElementById("browse").hidden = Boolean(loan);
  control.hidden = !loan;
  if (loan) {
    document.getElementById("loan-name").textContent = loan.application;
    document.getElementById("loan-label").textContent = loan.label;
    return;
  }
  reset();
  requests.replaceChildren();
  document.getElementById("empty").hidden = slots.length > 0 || !connected;
  for (const slot of slots) {
    if (slot.capability !== "stick2d") continue;
    const row = document.getElementById("request-template").content.cloneNode(true);
    row.querySelector("h2").textContent = slot.application;
    row.querySelector("p").textContent = slot.label;
    const button = row.querySelector("button");
    button.textContent = slot.lender ? `Borrowed from ${slot.lender.name}` : "Lend my touchpad";
    button.disabled = !connected || Boolean(slot.lender);
    button.onclick = () => {
      feedback.textContent = "";
      button.disabled = true;
      const name = document.getElementById("nickname").value.trim() || "A phone";
      connection.send({ type: "claim", slot: slot.id, name });
    };
    requests.append(row);
  }
}

// The phone normalizes touch coordinates. It knows nothing about either sketch.
function move(x, y) {
  const value = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  const puck = document.getElementById("puck");
  puck.style.left = `${50 + value.x * 40}%`;
  puck.style.top = `${50 - value.y * 40}%`;
  if (loan) connection.send({ type: "value", slot: loan.id, value });
}
function reset() {
  pointer = null;
  move(0, 0);
}
function drag(event) {
  const bounds = touchpad.getBoundingClientRect();
  const x = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.4);
  const y = -(event.clientY - bounds.top - bounds.height / 2) / (bounds.height * 0.4);
  move(x, y);
}
touchpad.onpointerdown = event => {
  if (pointer !== null || event.button !== 0) return;
  pointer = event.pointerId;
  touchpad.setPointerCapture(pointer);
  drag(event);
};
touchpad.onpointermove = event => { if (event.pointerId === pointer) drag(event); };
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  touchpad.addEventListener(name, event => { if (event.pointerId === pointer) reset(); });
}
// Keyboard access also makes it easy to try the provider from a laptop.
touchpad.onkeydown = event => {
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (arrows[event.key]) { event.preventDefault(); move(...arrows[event.key]); }
};
touchpad.onkeyup = reset;
addEventListener("blur", reset);
function release() {
  reset();
  if (loan) connection.send({ type: "release", slot: loan.id });
}
document.getElementById("release").onclick = release;
document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
