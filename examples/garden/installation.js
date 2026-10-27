// Exhibition controls for this piece. Borrow only supplies its input.
export const settings = new URLSearchParams(location.search);
export const session = settings.get("session");
export const relay = settings.get("relay") || "http://localhost:8000";

export function install(borrow, input) {
  const info = document.getElementById("info");
  const toggle = document.getElementById("about-toggle");
  function toggleInfo() {
    info.hidden = !info.hidden;
    toggle.setAttribute("aria-expanded", String(!info.hidden));
  }
  toggle.onclick = toggleInfo;
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      document.getElementById("fullscreen").textContent = "Use your browser’s fullscreen command";
    }
  }
  document.getElementById("fullscreen").onclick = fullscreen;
  addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|BUTTON|A/.test(event.target.tagName)) return;
    if (event.key.toLowerCase() === "h") toggleInfo();
    if (event.key.toLowerCase() === "f") fullscreen();
    if (event.key === "Escape" && !info.hidden) toggleInfo();
  });
  borrow.onChange = () => {
    const status = borrow.status === "Connected"
      ? (input.lender ? `Borrowed from ${input.lender.name}` : "Available for someone to lend")
      : borrow.status;
    document.getElementById("status").textContent = status;
  };
  if (session) {
    const join = document.getElementById("join");
    const url = new URL(`/join/${encodeURIComponent(session)}`, relay);
    url.protocol = ["https:", "wss:"].includes(url.protocol) ? "https:" : "http:";
    join.href = url.href;
    join.hidden = false;
    borrow.connect();
  }
}
