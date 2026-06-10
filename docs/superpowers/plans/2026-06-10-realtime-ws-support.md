# jswidesky-client Realtime WebSocket Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@widesky/jswidesky-client` so it can carry the WideSky realtime watch + control protocol for a long-lived edge (the CoAP gateway, [VM-243](https://widesky.atlassian.net/browse/VM-243)) as well as the existing browser-dashboard consumer.

**Architecture:** Today the client exposes `watchSub`/`watchExtend`/`watchUnsub` (REST) and `getWatchSocket()` (a raw socket.io-client Socket). For a gateway that holds a socket for days and both *responds to* and *issues* point-write control commands, three things are missing: a token that stays valid across reconnects, a typed wrapper for the `pointWrite`/`reportWrite` control protocol, and (eventually) a way to push readings upstream. We add these as additive API on `WideSkyClient`, keeping the existing methods working.

**Tech Stack:** CommonJS, socket.io-client `^2.4.0` (must stay v2-compatible — the WideSky API server runs `socket.io@2.4.1`), mocha + chai + sinon (stubbed sockets; integration verified later on `widesky-hub-e2e-sim`).

**Cross-repo note:** This is the api-server-client side of VM-243. The CoAP gateway (`widesky-hub-gw`) consumes these methods. The reading-publish task is **blocked** on the WideSky API server defining a WebSocket reading-ingest contract (owned by another team) — the API server currently ingests edge readings only over AMQP.

**Convention note:** This repo uses `CORE-*` Jira keys and branches `feature/CORE-XXXX-...`. Assign a CORE key for execution; the work is tracked against VM-243 cross-repo.

---

## Status of this plan

- **Task 1 (token correctness)** — DONE. `getWatchSocket` awaits `getToken()`; unit test added.
- **Task 2 (reconnect token refresh)** — DONE. `getWatchSocket` refreshes the token on
  `reconnect_attempt`; unit test added.
- **Task 3 (`RealtimeControl` helper)** — DONE. `src/client/realtimeControl.js` +
  `client.watchControl(socket)`; responder + requestor roles; exported with `WRITE_STATUS`; 6 unit
  tests. Integration verification (against a live API server socket) happens with `widesky-hub-gw`
  Plan B on `widesky-hub-e2e-sim`.
- **Task 4 (structured `watchSub`)** — TODO (additive `v2` helper).
- **Task 5 (reading publish)** — BLOCKED on the API-server reading-ingest contract.

---

## Task 1: `getWatchSocket` resolves the token before connecting — DONE

**Files:**
- Modify: `src/client/client.js` (`getWatchSocket`)
- Test: `test/realtime/socket.js`

`getToken()` returns the cached token object synchronously only when a valid token is already held; otherwise it returns a promise (login/refresh). The old `getWatchSocket` read `.access_token` off that value directly, yielding `Authorization: undefined` whenever a token had to be acquired. The method is now `async` and awaits `getToken()`.

- [x] **Step 1: Failing test** — `getToken()` resolving asynchronously must still produce a socket with the resolved token. (`test/realtime/socket.js`, "should await a promise-returning getToken()".)
- [x] **Step 2: Implementation** — `async getWatchSocket(watchId)` + `const tokens = await this.getToken();`.
- [x] **Step 3: Verify** — `npx mocha test/realtime/socket.js` passes (all three cases).

## Task 2: Refresh the token on socket reconnect

**Files:**
- Modify: `src/client/client.js` (`getWatchSocket`)
- Test: `test/realtime/socket.js`

A gateway socket outlives a short-lived access token. socket.io v2 re-presents the `query.Authorization` captured at connect time on every auto-reconnect, so once the token rotates the reconnect handshakes fail. Refresh the token on each reconnect attempt.

- [ ] **Step 1: Write the failing test**

```js
it("refreshes the Authorization token on reconnect_attempt", async function () {
    let http = new stubs.StubHTTPClient(),
        log = new stubs.StubLogger(),
        ws = getInstance(http, log);

    // A fake socket whose io.opts.query is mutated by the handler.
    const handlers = {};
    const fakeSocket = {
        io: { opts: { query: {} } },
        on(event, cb) { handlers[event] = cb; return this; },
    };
    sinon.stub(socket, "connect").returns(fakeSocket);

    const tokenStub = sinon.stub(ws, "getToken");
    tokenStub.onCall(0).resolves({ access_token: "tok-1" });
    tokenStub.onCall(1).resolves({ access_token: "tok-2" });

    await ws.getWatchSocket(TEST_WATCH_ID);
    expect(fakeSocket.io.opts.query.Authorization).to.equal("tok-1");

    // Simulate socket.io's reconnect attempt.
    await handlers["reconnect_attempt"]();
    expect(fakeSocket.io.opts.query.Authorization).to.equal("tok-2");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx mocha test/realtime/socket.js --grep "reconnect_attempt"`
Expected: FAIL — no `reconnect_attempt` handler registered.

- [ ] **Step 3: Implement**

In `getWatchSocket`, after creating the socket, register a handler that refreshes the token onto `io.opts.query` (so the next handshake uses it):

```js
const ioSocket = socket.connect(url, {
    query: { Authorization: accessToken },
    'force new connection': true,
    autoConnect: false,
    path: `${subPath}/socket.io`
});

ioSocket.on('reconnect_attempt', async () => {
    try {
        const refreshed = await this.getToken();
        ioSocket.io.opts.query = Object.assign(
            {}, ioSocket.io.opts.query, { Authorization: refreshed.access_token }
        );
    } catch (err) {
        /* istanbul ignore next */
        if (this.logger) {
            this.logger.warn(err, 'Failed to refresh watch socket token on reconnect');
        }
    }
});

return ioSocket;
```

- [ ] **Step 4: Verify**

Run: `npx mocha test/realtime/socket.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/client/client.js test/realtime/socket.js
git commit -m "CORE-XXXX: refresh watch socket token on reconnect"
```

## Task 3: `RealtimeControl` helper for the `pointWrite`/`reportWrite` protocol

**Files:**
- Create: `src/client/realtimeControl.js`
- Modify: `src/client/client.js` (factory method `watchControl(socket)`)
- Test: `test/realtime/control.js`

Wrap the raw socket with a typed helper that owns the control protocol (the API server contract in `controlCmdRouter` / `realtimeVars`). It serves both roles:

- **Responder (gateway):** `onPointWrite(handler)` — invoked with `{requestId, data:[{id,value}]}`; the handler returns per-point `{id, writeStatus, writeErr?}`; the helper emits the `reportWrite` reply with a fresh `responseId`.
- **Requestor (dashboard):** `pointWrite(points, opts)` — emits a `pointWrite` request and resolves when the correlated response arrives.

Message shape (must match the API server):
```
request:  { command: 'pointWrite',  requestId, data: [{ id, value }], timeout, alive, private }
response: { command: 'reportWrite', requestId, responseId, data: [{ id, writeStatus, writeErr }] }
```

Export the write-status constants (`ok`, `down`, `unbound`, `fault`, `disabled`, `unknown`) so callers don't hard-code strings.

- [ ] **Step 1: Write the failing test** (full responder + requestor round-trip against a sinon fake socket — see message shape above; assert a `pointWrite` in triggers the handler and emits a `reportWrite` with matching `requestId` and the handler's `writeStatus`).
- [ ] **Step 2: Run it to verify it fails** — `npx mocha test/realtime/control.js` → module not found.
- [ ] **Step 3: Implement** `RealtimeControl` (EventEmitter over the socket's `message` events; `requestId`→`responseId` correlation; `WRITE_STATUS` constants).
- [ ] **Step 4: Verify** — `npx mocha test/realtime/control.js` passes.
- [ ] **Step 5: Commit.**

## Task 4: `watchSub` returns a structured result

**Files:**
- Modify: `src/client/client.js` (`watchSub`)
- Test: `test/realtime/watch.js`

Today `watchSub` resolves to a raw Haystack grid; callers parse the watch id out by hand. Add a thin structured accessor (without breaking the existing grid return — e.g. a `v2.watchOpen()` helper that returns `{watchId, lease}`), so the gateway's subscription manager has a stable shape.

- [ ] Steps: failing test asserting `{watchId, lease}` extracted from a stubbed `watchSub` grid response → implement helper in `src/client/functions/v2.js` → verify → commit. (Keep the existing `watchSub` grid return intact — additive only.)

## Task 5: Reading publish — BLOCKED (API-server contract)

**Files (when unblocked):**
- Modify: `src/client/client.js` or `src/client/functions/v2.js`

The API server has no WebSocket verb for an edge to push an unsolicited reading (today readings ride AMQP). When the API-server team defines the contract:
- If a **new socket verb** → add an emit method (e.g. `RealtimeControl.publishReading(points)`).
- If **`hisWrite`-based** → `hisWrite` already exists; confirm it drives realtime curVal + watcher notify, else a new verb is still required.

Do not implement until the contract is published. Track against the API-server ticket.

---

## Self-Review notes

- **Spec coverage:** token validity (T1 done, T2), control protocol both roles (T3), structured watch (T4), reading publish (T5, gated).
- **Backward compatibility:** T1 makes `getWatchSocket` return a `Promise<Socket>` — the existing test already `await`s it; documented in CHANGELOG. T3/T4 are additive.
- **v2 constraint:** socket.io-client stays on `^2.4.0` to match the API server; do not bump to v4 here.
- **Runtime split:** no new top-level Node-only requires (browser build must keep working). socket.io-client is isomorphic.
