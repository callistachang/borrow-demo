import p5 from "p5";
import { createBorrow } from "@borrow/sdk";
import { install, session, relay } from "./installation.js";

const borrow = createBorrow({ session, relay, name: "Living Garden" });
const wind = borrow.stick2d("wind", { label: "Lend movement to stir the garden’s wind." });
install(borrow, wind);

new p5(p => {
  let seeds = [];
  let time = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colors = ["#b7e6cf", "#efb399", "#e9d492", "#8fc7d7"];
  p.setup = () => {
    p.createCanvas(innerWidth, innerHeight);
    p.pixelDensity(Math.min(devicePixelRatio, 2));
    p.frameRate(30);
    seeds = Array.from({ length: 105 }, () => ({ x: p.random(), y: p.random(), size: p.random(2, 5), phase: p.random(p.TWO_PI) }));
  };
  p.draw = () => {
    const { x, y } = wind.value;
    const ambient = reducedMotion ? 0 : 1;
    time += .016 * ambient;
    p.background("#102d3a");
    // Stems make the control's direction visible even when the particles wrap.
    for (let i = 0; i < 22; i++) {
      const root = (i + .5) * p.width / 22;
      const height = p.height * (.18 + .16 * p.noise(i));
      const sway = Math.sin(time + i) * 8 + x * 65;
      p.noFill(); p.stroke("#527f73"); p.strokeWeight(1.5);
      p.bezier(root, p.height - 65, root, p.height - 95, root + sway * .4, p.height - height, root + sway, p.height - height - 40 - y * 25);
      p.noStroke(); p.fill(colors[i % colors.length]);
      p.ellipse(root + sway, p.height - height - 40 - y * 25, 7, 12);
    }
    seeds.forEach((seed, i) => {
      seed.x = (seed.x + x * .008 + Math.cos(time + seed.phase) * .00045 * ambient + 1) % 1;
      seed.y = (seed.y - y * .009 - .0008 * ambient + 1) % 1;
      const sx = seed.x * p.width, sy = 100 + seed.y * (p.height - 180);
      p.noStroke(); p.fill(colors[i % colors.length]);
      p.circle(sx, sy, seed.size);
      if (i % 4 === 0) { p.stroke("#ffffff24"); p.line(sx, sy, sx - x * 18, sy + 5 + y * 15); }
    });
  };
  p.windowResized = () => p.resizeCanvas(innerWidth, innerHeight);
});
