import p5 from "p5";
import { createHost } from "@borrow/sdk";

const protocol = location.protocol === "https:" ? "wss" : "ws";
const borrow = createHost("Kinetic Ribbon", {
  url: import.meta.env.VITE_BORROW_URL ?? `${protocol}://${location.hostname}:8000/ws`,
});
const bend = borrow.axis2d("bend");
const colors = borrow.button("colors");
window.borrowDemo = { borrow, bend, colors }; // debug
let warm = false;
colors.onPress(() => {
  warm = !warm;
});

new p5((p) => {
  let time = 0;
  const displayedBend = { x: 0, y: 0 };
  const bendResponseMs = 60;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  p.setup = () => {
    p.createCanvas(innerWidth, innerHeight);
    p.pixelDensity(Math.min(devicePixelRatio, 2));
    p.frameRate(60);
  };
  p.draw = () => {
    p.background("#233451");
    time += reducedMotion ? 0 : p.deltaTime * 0.00054;
    const target = bend.value;
    // Ease between input samples at the same rate regardless of drawing FPS.
    const blend = 1 - Math.exp(-p.deltaTime / bendResponseMs);
    displayedBend.x += (target.x - displayedBend.x) * blend;
    displayedBend.y += (target.y - displayedBend.y) * blend;
    const frequency = 1.5 + displayedBend.x * 0.9;
    const amplitude = p.height * (0.1 + (displayedBend.y + 1) * 0.055);
    p.noFill();
    p.strokeWeight(1.5);
    for (let strand = 0; strand < 24; strand++) {
      const mix = strand / 23;
      p.stroke(
        p.lerpColor(
          p.color(warm ? "#efa58d" : "#9ccbdc"),
          p.color(warm ? "#f7d794" : "#efa58d"),
          mix,
        ),
      );
      p.beginShape();
      for (let x = -10; x <= p.width + 10; x += 5) {
        const position = x / p.width;
        const wave = Math.sin(
          position * p.TWO_PI * frequency + time + strand * 0.055,
        );
        const envelope = Math.sin(position * Math.PI);
        p.vertex(
          x,
          p.height * 0.51 + wave * amplitude * envelope + (strand - 12) * 3,
        );
      }
      p.endShape();
    }
  };
  p.windowResized = () => p.resizeCanvas(innerWidth, innerHeight);
});
