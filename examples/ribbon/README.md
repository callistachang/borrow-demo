# Kinetic Ribbon

An independent p5.js installation. Borrow supplies an optional movement input.

```sh
npm ci
npm run dev
```

Open `http://localhost:8002/`. F enters fullscreen; H opens the work’s note.
The animation runs without a relay. To accept borrowed input, join an existing
Borrow session through the URL:

```
http://localhost:8002/?relay=http://localhost:8000&session=YOUR_SESSION_ID
```

Create a session at the relay’s phone provider (`http://localhost:8000`). Use a
LAN or hosted relay address for phones; the artwork itself may stay on localhost.

`npm run build` produces a standalone static site in `dist/`.
`npm run preview` serves that build on port 8002.

This project owns its dependencies, styles, drawing, and exhibition controls.
Its only Borrow dependency is `@borrow/sdk`, linked from `../../sdk/js`.
