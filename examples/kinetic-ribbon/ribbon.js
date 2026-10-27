import p5 from "p5";
import { createHost } from "@borrow/sdk";

const borrow = createHost("Kinetic Ribbon");
const bend = borrow.axis2d("bend");
const colors = borrow.button("colors");
window.borrowDemo = { borrow, bend, colors }; // debug
let warm = false;
colors.onPress(() => {
  warm = !warm;
});

new p5((p) => {
  let time = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  p.setup = () => {
    p.createCanvas(innerWidth, innerHeight);
    p.pixelDensity(Math.min(devicePixelRatio, 2));
    p.frameRate(30);
  };
  p.draw = () => {
    p.background("#233451");
    time += reducedMotion ? 0 : 0.018;
    const frequency = 1.5 + bend.value.x * 0.9;
    const amplitude = p.height * (0.1 + (bend.value.y + 1) * 0.055);
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
