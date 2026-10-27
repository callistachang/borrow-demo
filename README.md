# Borrow

A small relay and JavaScript SDK for lending hardware capabilities to independent
programs. The phone provider lends a `stick2d`; the example artworks consume it.

Each artwork is a separate project. The relay does not serve, launch, or know
about the examples. There is no shared demo dashboard.

```
server/             Python relay: sessions, requests, loans, input forwarding
sdk/js/             @borrow/sdk: browser connection and stick2d consumer API
providers/phone/    Generic phone provider and session QR, hosted by the relay
examples/garden/    Standalone p5.js artwork, its own npm package and dev server
examples/ribbon/    Another standalone artwork, its own npm package and dev server
```

## Run the relay and phone provider

Requires Python/uv and Node.js 22.12+ (or 20.19+).

```sh
cd providers/phone
npm ci
cd ../../server
uv run --locked python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` to create a lending session. Expand **Invite a phone /
session details** for the QR, session ID, and relay address. For a real phone,
open this page using the computer's LAN address or the hosted HTTPS address
before scanning. The QR uses that address; `localhost` on a phone is the phone.

Disco deploys only the relay and generic phone provider. Sessions live in memory;
run one server process, and expect sessions to end when it restarts.

## Run an artwork

In a separate terminal:

```sh
cd examples/garden
npm ci
npm run dev
```

Open `http://localhost:8001/` for the ambient artwork. To let the session lend to
it, use the session ID from the phone provider:

```
http://localhost:8001/?relay=http://localhost:8000&session=YOUR_SESSION_ID
```

Ribbon works the same way from its own directory, on port 8002:

```sh
cd examples/ribbon
npm ci
npm run dev
```

```
http://localhost:8002/?relay=http://localhost:8000&session=YOUR_SESSION_ID
```

Use the same session for both works. The phone discovers both requests without
changes to the provider. Lend to one, release, then lend to the other.

Both pieces fill their browser viewport with art. **F** enters fullscreen;
**H** opens a small note with connection status and lender attribution. No relay
or session is needed for the ambient animation. Each project also has its own
`npm run build` and `npm run preview` for serving a static production build.

Each example depends on `@borrow/sdk` through `file:../../sdk/js`. This is a local
library dependency, not a workspace or shared app shell. Drawing code, styles,
exhibition controls, p5.js, build dependencies, and lockfiles belong to each work.

## Use the SDK

```js
import { createBorrow } from "@borrow/sdk";

const borrow = createBorrow({
  relay: "https://your-relay.example",
  session: "YOUR_SESSION_ID",
  name: "My independent artwork",
});
const wind = borrow.stick2d("wind", { label: "Lend movement to stir the wind" });
borrow.connect();

// In your drawing loop, read wind.value.x and wind.value.y (-1 to 1).
// The drawing does not know whether the input comes from a phone.
```

`relay` accepts an HTTP(S) or WebSocket URL. Omit it for a same-origin connection,
as the phone provider does. An HTTPS artwork should use an HTTPS/WSS relay.

## Protocol and boundaries

- `register`: a consumer declares one input, or a phone registers as a provider.
- `snapshot`: current requests and lenders.
- `claim`: a phone offers its touchpad to a free compatible request.
- `value`: normalized `{x, y}` input forwarded to the owning consumer.
- `release`: returns the input to neutral and makes the request available.
- `ping` / `pong`: detect silent disconnects.

`hello` supplies a connection ID; `error` explains a rejected action. Ownership
changes are serialized by the relay's lock.

One `stick2d` per consumer and one loan per phone. Positive x is right; positive y
is up. Lifting a finger sends zero without ending the loan. Release, hiding the
phone page, or disconnecting frees it. Occupied requests cannot be taken over.
On connection loss, input returns to zero; reload to reconnect. There are no
accounts, queues, tilt controls, automatic retries, or database.
