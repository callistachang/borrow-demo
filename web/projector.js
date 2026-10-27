const start = document.getElementById("start");
const message = document.getElementById("message");
const session = location.pathname.split("/")[2];

start.onclick = async () => {
  start.disabled = true;
  try {
    const response = await fetch("/api/sessions", { method: "POST" });
    if (!response.ok) throw new Error("Could not start a session. Try again.");
    const result = await response.json();
    location.href = result.projector;
  } catch (error) {
    message.textContent = error.message;
    start.disabled = false;
  }
};

if (session) {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(session)}`);
    if (!response.ok) throw new Error("Could not check this session. Reload to try again.");
    if (!(await response.json()).exists) throw new Error("Session ended. Start a new one.");
    start.hidden = true;
    const joinURL = `${location.origin}/join/${encodeURIComponent(session)}`;
    const link = document.getElementById("join-link");
    link.href = joinURL;
    const qr = qrcode(0, "M");
    qr.addData(joinURL);
    qr.make();
    document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    document.getElementById("join").hidden = false;
    for (const name of ["garden", "ribbon"]) {
      document.getElementById(name).src = `/examples/${name}/?session=${encodeURIComponent(session)}`;
    }
  } catch (error) {
    message.textContent = error.message;
  }
}
