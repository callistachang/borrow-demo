# Borrow

A small demo: lend the same phone touchpad to two independent p5.js sketches.

## Run

From the repository root (requires Node/npm and uv):

```sh
npm ci
npm start
```

Open `http://localhost:8000` and start a session. For a real phone, open the
projector using the computer's LAN address or the hosted HTTPS address **before**
scanning: the QR uses the address you opened. `localhost` on a phone means the phone.

The existing Disco configuration packages the pages and server together. Run one
server process: sessions live in memory and end when the server restarts.

## Read the code in this order

1. **`examples/ribbon/ribbon.js`** — asks for a `stick2d`, then uses its `x` and `y`
   to draw a wave. The drawing does not know whether input came from a phone.
2. **`sdk/js/index.js`** — a WebSocket connection and one consumer helper.
   `onMessage` / `onChange` are ordinary functions called when data arrives.
3. **`providers/phone/phone.js`** — shows discovered requests, lets you choose one,
   and converts touch position into numbers between -1 and 1.
4. **`server/main.py`** — keeps sessions, clients, and input requests in dictionaries.
   It checks who owns each loan and forwards values to that consumer.

The phone and relay contain no sketch names or special cases for either example.

## The messages

- `register`: a sketch declares one input, or a phone registers as a provider.
- `snapshot`: the server sends everyone the current requests and lenders.
- `claim`: a phone offers its touchpad to a free request.
- `value`: the phone sends `{x, y}`; the server forwards it to the owner of the request.
- `release`: the phone gives up the request; the server sends neutral input.
- `ping` / `pong`: detect silent disconnects so a missing phone cannot keep a loan.

`hello` supplies a connection ID; `error` explains a rejected action.
The server's lock lets it finish one ownership change before starting another.

## MVP boundaries

One `stick2d` per consumer and one loan per phone. Positive x is right; positive y
is up. Lifting a finger sends zero without giving up the loan. Release, hiding the
phone page, or disconnecting frees it for someone else. Occupied requests cannot
be taken over.

On connection loss, inputs return to zero and the page asks you to reload.
There are no automatic retries, queues, accounts, tilt controls, or database.
The two drawings and QR library are the only visual extras; third-party browser
libraries are npm dependencies in `package.json`, pinned by `package-lock.json`.
FastAPI serves their installed scripts from `node_modules`; no frontend build step
or runtime CDN is needed. Docker installs them with `npm ci` too.

## Check the relay

From `server/`, run:

```sh
uv run --with httpx python -m unittest discover -s tests
```
