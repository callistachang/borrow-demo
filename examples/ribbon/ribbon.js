import { createBorrow } from "/sdk/index.js";
import { showBinding } from "/examples/status.js";

const session = new URLSearchParams(location.search).get("session");
const borrow = createBorrow({ session, name: "Kinetic Ribbon" });
const bend = borrow.stick2d("bend", { label: "Shape the ribbon using your touchpad." });
showBinding(borrow, bend);
if (session) borrow.connect();

new p5(p => {
  let time = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  p.setup = () => { p.createCanvas(innerWidth, innerHeight); p.pixelDensity(Math.min(devicePixelRatio, 2)); p.frameRate(30); };
  p.draw = () => {
    p.background("#233451");
    time += reducedMotion ? 0 : .018;
    const frequency = 1.5 + bend.value.x * .9;
    const amplitude = p.height * (.1 + (bend.value.y + 1) * .055);
    p.noFill(); p.strokeWeight(1.5);
    for (let strand = 0; strand < 24; strand++) {
      const mix = strand / 23;
      p.stroke(p.lerpColor(p.color("#9ccbdc"), p.color("#efa58d"), mix));
      p.beginShape();
      for (let x = -10; x <= p.width + 10; x += 5) {
        const position = x / p.width;
        const wave = Math.sin(position * p.TWO_PI * frequency + time + strand * .055);
        const envelope = Math.sin(position * Math.PI);
        p.vertex(x, p.height * .51 + wave * amplitude * envelope + (strand - 12) * 3);
      }
      p.endShape();
    }
  };
  p.windowResized = () => p.resizeCanvas(innerWidth, innerHeight);
});
