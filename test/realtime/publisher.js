/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for the realtime publisher session (CORE-8664).
 *
 * HTTP is stubbed via StubHTTPClient (no live server); sockets are stubbed by
 * replacing socket.io-client's connect() with a fake EventEmitter socket so the
 * handshake args, outbound pointUpdate frames, and inbound event dispatch can be
 * asserted without a real connection.
 *
 * Socket-loss recovery tests drive time with sinon.useFakeTimers() (never the
 * wall clock) so the disconnect-grace window and the recovery backoff are
 * deterministic, matching the watchRenew suite.
 */
"use strict";

const socket = require("socket.io-client"),
    stubs = require("../stubs"),
    expect = require("chai").expect,
    sinon = require("sinon"),
    EventEmitter = require("events"),
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const { verifyTokenCall, verifyRequestCall } = require("../client/utils");

const TEST_POINTS = [
    "00000000-0001-0001-0001-000000000000",
    "00000000-0001-0001-0001-000000000001",
    "00000000-0001-0001-0001-000000000002",
];
const TEST_WATCH_ID = "11111111-aaa1-bbb1-ccc1-222222222222";

/**
 * A fake socket.io-client socket: an EventEmitter with the surface the
 * publisher touches (open/close/disconnect/connect/emit). It records the
 * messages emitted out to the server and lets a test drive inbound events with
 * .serverEmit().
 */
class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.opened = false;
        this.connected = false;
        this.closed = false;
        this.disconnected = false;
        /* Frames emitted toward the server, each { event, payload }. */
        this.sent = [];
    }

    /* socket.io-client emit toward the server. */
    emit(event, payload) {
        /* 'message'/pointUpdate is outbound; local lifecycle events still need
         * EventEmitter semantics for our own listeners, but the publisher only
         * ever sends 'message' frames via emit(), so record those. */
        if (event === "message") {
            this.sent.push({ event, payload });
            return true;
        }
        return super.emit(event, payload);
    }

    open() {
        this.opened = true;
        /* Mimic socket.io firing 'connect' asynchronously after open(). */
        setImmediate(() => {
            this.connected = true;
            super.emit("connect");
        });
    }

    disconnect() {
        this.disconnected = true;
        this.connected = false;
        super.emit("disconnect", "io client disconnect");
        return this;
    }

    close() {
        this.closed = true;
        return this;
    }

    /* Drive an inbound server-to-publisher event in a test. */
    serverEmit(event, payload) {
        super.emit(event, payload);
    }

    /* True while this socket is still "live": opened, not torn down. A socket
     * whose reconnection loop was stopped has been disconnect()ed and close()d. */
    isLive() {
        return this.opened && !this.disconnected && !this.closed;
    }
}

/**
 * A fake socket whose open() reports connect_error instead of connect, so a
 * connect() against it always rejects. Used to drive failed recovery iterations
 * (the apiserver refusing the socket handshake while it settles after a
 * restart).
 */
class FailOpenSocket extends FakeSocket {
    open() {
        this.opened = true;
        setImmediate(() => {
            EventEmitter.prototype.emit.call(
                this, "connect_error", "Invalid namespace");
        });
    }
}

describe("Realtime", function () {
    describe("publisher", function () {
        beforeEach(() => {
            sinon.restore();
        });

        /* ------------------------------------------------------------
         * watchPub request shapes (three modes) + watchUnpub
         * ---------------------------------------------------------- */

        describe("watchPub", function () {
            it("should POST a fresh-mode watchPub body verbatim", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                const body = {
                    onDisconnect: { mode: "grace", graceMs: 60000 },
                    shortRefs: { "0": `r:${TEST_POINTS[0]}` },
                    data: [
                        { id: TEST_POINTS[0], intervalFast: 1000, intervalSlow: 0 },
                    ],
                };

                await pub.watchPub(body);

                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyTokenCall(ws._wsRawSubmit.firstCall.args);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "POST",
                    "/api/watchPub",
                    body,
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json",
                        },
                        decompress: true,
                    }
                );
            });

            it("should POST a referenced-update body with watchId in place", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                const body = {
                    watchId: TEST_WATCH_ID,
                    data: [
                        { id: TEST_POINTS[0], intervalFast: 1000 },
                        { id: TEST_POINTS[1], intervalFast: 5000, intervalSlow: 60000 },
                    ],
                };

                await pub.watchPub(body);

                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "POST",
                    "/api/watchPub",
                    body,
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json",
                        },
                        decompress: true,
                    }
                );
            });

            it("should POST a supersede body (no watchId, overlapping points)", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                const body = {
                    data: [
                        { id: TEST_POINTS[0], intervalFast: 1000 },
                        { id: TEST_POINTS[1], intervalFast: 1000 },
                    ],
                };

                await pub.watchPub(body);

                const sent = ws._wsRawSubmit.secondCall.args[2];
                expect(sent).to.deep.equal(body);
                expect(sent.watchId).to.equal(undefined);
            });

            it("should stash the server-assigned watchId on the session", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                /* Override the stub so watchPub resolves a watchId. */
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.resolve({ watchId: TEST_WATCH_ID, data: [] });
                });

                const pub = ws.createPublisher();
                const res = await pub.watchPub({
                    data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                });

                expect(res.watchId).to.equal(TEST_WATCH_ID);
                expect(pub.watchId).to.equal(TEST_WATCH_ID);
            });

            it("should reject the retired intervalHot field name", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                let err = null;
                try {
                    await pub.watchPub({
                        data: [{ id: TEST_POINTS[0], intervalHot: 1000 }],
                    });
                } catch (e) {
                    err = e;
                }
                expect(err).to.not.equal(null);
                expect(err.message).to.match(/intervalFast\/intervalSlow/);
                /* It must fail BEFORE any REST round-trip (only the token call,
                 * if any, may have run during getInstance — assert no watchPub). */
                const watchPubs = ws._wsRawSubmit
                    .getCalls()
                    .filter((c) => c.args[1] === "/api/watchPub").length;
                expect(watchPubs).to.equal(0);
            });

            it("should reject the retired intervalWarm field name", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                let err = null;
                try {
                    await pub.watchPub({
                        data: [
                            { id: TEST_POINTS[0], intervalFast: 1000, intervalWarm: 0 },
                        ],
                    });
                } catch (e) {
                    err = e;
                }
                expect(err).to.not.equal(null);
                expect(err.message).to.match(/intervalFast\/intervalSlow/);
            });

            it("should accept the intervalFast/intervalSlow field names", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                const body = {
                    data: [
                        { id: TEST_POINTS[0], intervalFast: 1000, intervalSlow: 0 },
                    ],
                };

                await pub.watchPub(body);

                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "POST",
                    "/api/watchPub",
                    body,
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json",
                        },
                        decompress: true,
                    }
                );
            });
        });

        describe("watchUnpub", function () {
            it("should POST { watchId } for the stashed watch", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                pub.watchId = TEST_WATCH_ID;

                await pub.watchUnpub();

                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "POST",
                    "/api/watchUnpub",
                    { watchId: TEST_WATCH_ID },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json",
                        },
                        decompress: true,
                    }
                );
            });

            it("should POST { watchId } for an explicit watch id", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                await pub.watchUnpub("99999999-aaa1-bbb1-ccc1-222222222222");

                expect(ws._wsRawSubmit.secondCall.args[2]).to.deep.equal({
                    watchId: "99999999-aaa1-bbb1-ccc1-222222222222",
                });
            });
        });

        /* ------------------------------------------------------------
         * Socket connect handshake
         * ---------------------------------------------------------- */

        describe("connect handshake", function () {
            it("should connect with the token in the query like watch sockets", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID);

                expect(socket.connect.callCount).to.equal(1);
                expect(socket.connect.getCall(0).args).to.eql([
                    `http://localhost:3000/${TEST_WATCH_ID}`,
                    {
                        query: { Authorization: WS_ACCESS_TOKEN },
                        "force new connection": true,
                        autoConnect: false,
                        reconnection: true,
                        path: "/socket.io",
                    },
                ]);
                expect(fake.opened).to.equal(true);
            });

            it("should honour a baseUri subpath in the socket path", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log, {
                        baseUrl: "http://localhost:3000/widesky",
                    });

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID);

                const args = socket.connect.getCall(0).args;
                expect(args[0]).to.equal(`http://localhost:3000/${TEST_WATCH_ID}`);
                expect(args[1].path).to.equal("/widesky/socket.io");
            });

            it("should default to the watchPub-assigned watchId", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                pub.watchId = TEST_WATCH_ID;
                await pub.connect();

                expect(socket.connect.getCall(0).args[0]).to.equal(
                    `http://localhost:3000/${TEST_WATCH_ID}`
                );
            });

            it("should reject connect() with no watchId", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const pub = ws.createPublisher();
                let threw = false;
                try {
                    await pub.connect();
                } catch (err) {
                    threw = true;
                    expect(err.message).to.match(/watchId/);
                }
                expect(threw).to.equal(true);
            });

            it("should reject when the socket reports connection_error", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                /* Override open() to fire connection_error instead of connect. */
                fake.open = function () {
                    this.opened = true;
                    setImmediate(() =>
                        EventEmitter.prototype.emit.call(
                            this,
                            "connection_error",
                            "Not authorised"
                        )
                    );
                };
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                let reason = null;
                try {
                    await pub.connect(TEST_WATCH_ID);
                } catch (err) {
                    reason = err;
                }
                expect(reason).to.equal("Not authorised");
            });

            it("should tear the failed socket down on a connect_error reject (no leak)", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FailOpenSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                /* autoRecover off so the rejected connect does not kick a
                 * recovery loop; we are asserting connect()'s own cleanup. */
                const pub = ws.createPublisher({ autoRecover: false });
                let threw = false;
                try {
                    await pub.connect(TEST_WATCH_ID);
                } catch (err) {
                    threw = true;
                }
                expect(threw).to.equal(true);
                /* The leaked-socket defect: connect() left this.socket pointing at
                 * the failed, still-reconnecting socket and never tore it down. */
                expect(fake.isLive()).to.equal(false);
                expect(pub.socket).to.equal(null);
            });

            it("should tear the failed socket down on a timeout reject (no leak)", async function () {
                const clock = sinon.useFakeTimers();
                try {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    /* A socket whose open() never resolves the handshake. */
                    const fake = new FakeSocket();
                    fake.open = function () {
                        this.opened = true;
                    };
                    sinon.stub(socket, "connect").returns(fake);
                    sinon.stub(ws, "getToken")
                        .returns({ access_token: WS_ACCESS_TOKEN });

                    const pub = ws.createPublisher({ autoRecover: false });
                    const p = pub.connect(TEST_WATCH_ID, { timeoutMs: 100 });
                    let threw = false;
                    p.catch(() => { threw = true; });

                    await clock.tickAsync(101);

                    expect(threw).to.equal(true);
                    expect(fake.isLive()).to.equal(false);
                    expect(pub.socket).to.equal(null);
                } finally {
                    clock.restore();
                }
            });
        });

        /* ------------------------------------------------------------
         * pointUpdate emission shapes
         * ---------------------------------------------------------- */

        describe("pointUpdate", function () {
            async function connectedPub(opts) {
                opts = opts || {};
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });
                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID);
                return { pub, fake };
            }

            it("should emit a full-ref pointUpdate frame", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate([
                    { id: TEST_POINTS[0], curVal: 42.7 },
                    { id: TEST_POINTS[1], curStatus: "down", curErr: "PLC unreachable" },
                ]);

                expect(fake.sent.length).to.equal(1);
                expect(fake.sent[0].event).to.equal("message");
                expect(fake.sent[0].payload).to.deep.equal({
                    command: "pointUpdate",
                    data: [
                        { id: TEST_POINTS[0], curVal: 42.7 },
                        { id: TEST_POINTS[1], curStatus: "down", curErr: "PLC unreachable" },
                    ],
                });
            });

            it("should emit a compact short-ref frame", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate([
                    { id: "0", curVal: 42.7 },
                    { id: "1", curStatus: "down", curErr: "PLC unreachable" },
                    { id: "2", curVal: 10.5 },
                ]);

                expect(fake.sent[0].payload).to.deep.equal({
                    command: "pointUpdate",
                    data: [
                        { id: "0", curVal: 42.7 },
                        { id: "1", curStatus: "down", curErr: "PLC unreachable" },
                        { id: "2", curVal: 10.5 },
                    ],
                });
                expect(fake.sent[0].payload.ts).to.equal(undefined);
            });

            it("should include a message-level ts when supplied", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate(
                    [{ id: "0", curVal: 1 }],
                    { ts: "2026-05-26T10:00:00.000Z" }
                );

                expect(fake.sent[0].payload.ts).to.equal("2026-05-26T10:00:00.000Z");
            });

            it("should forward a frame-level his:true when supplied", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate([{ id: "0", curVal: 1 }], { his: true });

                /* his rides at the frame level (message.his), matching the
                 * apiserver socketDispatch handler that reads message.his === true
                 * to also persist each value to history. */
                expect(fake.sent[0].payload.his).to.equal(true);
            });

            it("should omit his entirely when not supplied", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate([{ id: "0", curVal: 1 }]);

                /* Absent his is the default cur-only frame; the property must not
                 * appear so the server's `message.his === true` test is false. */
                expect("his" in fake.sent[0].payload).to.equal(false);
            });

            it("should pass an id-only no-op entry through unchanged", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate([{ id: "0" }]);

                expect(fake.sent[0].payload).to.deep.equal({
                    command: "pointUpdate",
                    data: [{ id: "0" }],
                });
            });

            it("should wrap a single entry object in an array", async function () {
                const { pub, fake } = await connectedPub();

                pub.pointUpdate({ id: "0", curVal: 9 });

                expect(fake.sent[0].payload.data).to.deep.equal([
                    { id: "0", curVal: 9 },
                ]);
            });

            it("should throw if called before connect()", function () {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const pub = ws.createPublisher();

                expect(() => pub.pointUpdate([{ id: "0", curVal: 1 }])).to.throw(
                    /before connect/
                );
            });
        });

        /* ------------------------------------------------------------
         * Inbound: pointCadence dispatch + connect burst
         * ---------------------------------------------------------- */

        describe("pointCadence", function () {
            async function connectedPub() {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });
                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID);
                return { pub, fake };
            }

            it("should emit pointCadence for a named cadence event", async function () {
                const { pub, fake } = await connectedPub();

                const received = [];
                pub.on("pointCadence", (p) => received.push(p));

                fake.serverEmit("pointCadence", {
                    command: "pointCadence",
                    data: [{ id: "0", mode: "fast" }],
                });

                expect(received).to.have.length(1);
                expect(received[0].data).to.deep.equal([{ id: "0", mode: "fast" }]);
            });

            it("should dispatch a connect-time cadence burst (multiple points)", async function () {
                const { pub, fake } = await connectedPub();

                const received = [];
                pub.on("pointCadence", (p) => received.push(p));

                /* Server replays the current cadence for every claimed point on
                 * connect. */
                fake.serverEmit("pointCadence", {
                    command: "pointCadence",
                    data: [
                        { id: "0", mode: "fast" },
                        { id: "1", mode: "slow" },
                        { id: "2", mode: "slow" },
                    ],
                });

                expect(received).to.have.length(1);
                expect(received[0].data).to.have.length(3);
            });

            it("should also dispatch cadence via the message envelope", async function () {
                const { pub, fake } = await connectedPub();

                const received = [];
                pub.on("pointCadence", (p) => received.push(p));

                fake.serverEmit("message", {
                    command: "pointCadence",
                    data: [{ id: "1", mode: "slow" }],
                });

                expect(received).to.have.length(1);
                expect(received[0].data).to.deep.equal([{ id: "1", mode: "slow" }]);
            });
        });

        /* ------------------------------------------------------------
         * Inbound: pointUpdateError surfacing (incl. 409 superseded)
         * ---------------------------------------------------------- */

        describe("pointUpdateError", function () {
            async function connectedPub() {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });
                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID, { autoReregister: false });
                return { pub, fake };
            }

            it("should surface a 413 oversized-frame error", async function () {
                const { pub, fake } = await connectedPub();

                const errs = [];
                pub.on("pointUpdateError", (e) => errs.push(e));

                fake.serverEmit("pointUpdateError", {
                    command: "pointUpdateError",
                    err: "Frame exceeds maxPointsPerUpdate",
                    errorCode: 413,
                });

                expect(errs).to.have.length(1);
                expect(errs[0]).to.deep.equal({
                    err: "Frame exceeds maxPointsPerUpdate",
                    errorCode: 413,
                });
            });

            it("should surface a 404 namespace/ownership error", async function () {
                const { pub, fake } = await connectedPub();

                const errs = [];
                pub.on("pointUpdateError", (e) => errs.push(e));

                fake.serverEmit("pointUpdateError", {
                    command: "pointUpdateError",
                    err: "Namespace does not map to an active publisher watch owned by this user",
                    errorCode: 404,
                });

                expect(errs).to.have.length(1);
                expect(errs[0].errorCode).to.equal(404);
            });

            it("should emit a dedicated 'superseded' event on 409", async function () {
                const { pub, fake } = await connectedPub();

                const errs = [];
                const superseded = [];
                pub.on("pointUpdateError", (e) => errs.push(e));
                pub.on("superseded", (e) => superseded.push(e));

                fake.serverEmit("pointUpdateError", {
                    command: "pointUpdateError",
                    err: "Watch superseded by a newer registration for this user",
                    errorCode: 409,
                });

                expect(errs).to.have.length(1);
                expect(errs[0].errorCode).to.equal(409);
                expect(superseded).to.have.length(1);
                expect(superseded[0].errorCode).to.equal(409);
            });

            it("should surface errors arriving via the message envelope", async function () {
                const { pub, fake } = await connectedPub();

                const errs = [];
                pub.on("pointUpdateError", (e) => errs.push(e));

                fake.serverEmit("message", {
                    command: "pointUpdateError",
                    err: "boom",
                    errorCode: 413,
                });

                expect(errs).to.have.length(1);
                expect(errs[0].errorCode).to.equal(413);
            });
        });

        /* ------------------------------------------------------------
         * Reconnect logic
         * ---------------------------------------------------------- */

        describe("reconnect", function () {
            it("should rejoin within grace via a plain socket reconnect (no REST)", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID);

                /* socket.io has reconnection enabled, so a transient drop is
                 * healed by the library itself with no REST round-trip. */
                expect(socket.connect.getCall(0).args[1].reconnection).to.equal(
                    true
                );

                /* No watchPub/watchUnpub REST calls were made by the session
                 * (only the connect handshake which is socket-side). */
                expect(ws._wsRawSubmit.callCount).to.equal(0);

                /* A transient disconnect followed by socket.io 'connect' (rejoin)
                 * must NOT trigger any REST re-register. */
                const disc = [];
                const reconn = [];
                pub.on("disconnect", (r) => disc.push(r));
                pub.on("connect", () => reconn.push(true));

                fake.serverEmit("disconnect", "transport close");
                fake.serverEmit("connect");

                expect(disc).to.have.length(1);
                expect(reconn.length >= 1).to.equal(true);
                expect(ws._wsRawSubmit.callCount).to.equal(0);
            });

            it("should re-register with a fresh watchPub when the namespace is dead", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                let watchPubCalls = 0;
                ws._wsRawSubmit = sinon.spy((method, uri, body) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/watchPub") {
                        watchPubCalls += 1;
                        /* First call returns the original watchId; the recovery
                         * call returns a fresh one. */
                        return Promise.resolve({
                            watchId:
                                watchPubCalls === 1
                                    ? TEST_WATCH_ID
                                    : "fresh-watch-id",
                            data: [],
                        });
                    }
                    return Promise.resolve();
                });

                const sockets = [];
                sinon.stub(socket, "connect").callsFake(() => {
                    const s = new FakeSocket();
                    sockets.push(s);
                    return s;
                });
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                const body = {
                    onDisconnect: { mode: "grace", graceMs: 1000 },
                    data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                };
                await pub.watchPub(body);
                await pub.connect();
                expect(pub.watchId).to.equal(TEST_WATCH_ID);

                const reregistered = await new Promise((resolve, reject) => {
                    pub.on("reregister", (res) => resolve(res));
                    pub.on("reregisterError", (err) => reject(err));
                    /* Dead namespace: server says 404 on a pointUpdate. */
                    sockets[0].serverEmit("pointUpdateError", {
                        command: "pointUpdateError",
                        err: "Namespace does not map to an active publisher watch owned by this user",
                        errorCode: 404,
                    });
                });

                expect(reregistered.watchId).to.equal("fresh-watch-id");
                expect(pub.watchId).to.equal("fresh-watch-id");
                expect(watchPubCalls).to.equal(2);

                /* The recovery watchPub must NOT carry the stale watchId (fresh
                 * registration, design §7.4). */
                const recoveryBody = ws._wsRawSubmit
                    .getCalls()
                    .filter((c) => c.args[1] === "/api/watchPub")
                    .pop().args[2];
                expect(recoveryBody.watchId).to.equal(undefined);
                expect(recoveryBody.data).to.deep.equal(body.data);

                /* A second socket was opened for the fresh namespace, and it is
                 * the live one the session now publishes on. */
                expect(sockets.length).to.equal(2);
                expect(pub.socket).to.equal(sockets[1]);

                await pub.close();
            });

            it("should not re-register when autoReregister is disabled", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.resolve({ watchId: TEST_WATCH_ID, data: [] });
                });

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.watchPub({
                    data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                });
                await pub.connect(TEST_WATCH_ID, { autoReregister: false });

                const watchPubsBefore = ws._wsRawSubmit
                    .getCalls()
                    .filter((c) => c.args[1] === "/api/watchPub").length;

                let reregistered = false;
                pub.on("reregister", () => {
                    reregistered = true;
                });

                fake.serverEmit("pointUpdateError", {
                    command: "pointUpdateError",
                    err: "gone",
                    errorCode: 404,
                });

                /* Let any (incorrect) async re-register settle. */
                await new Promise((r) => setImmediate(r));

                const watchPubsAfter = ws._wsRawSubmit
                    .getCalls()
                    .filter((c) => c.args[1] === "/api/watchPub").length;

                expect(reregistered).to.equal(false);
                expect(watchPubsAfter).to.equal(watchPubsBefore);
            });
        });

        /* ------------------------------------------------------------
         * Socket-loss recovery (clean restart presents as a plain
         * disconnect / connect_error, not a 404). Mirrors the hub gateway's
         * ContextPublisher recovery cases, ported into the session itself.
         *
         * Setup (watchPub + connect) runs on the real clock; a fake clock is
         * then installed for the recovery phase so the disconnect-grace window
         * (RECOVER_DISCONNECT_GRACE_MS) and the recovery backoff are
         * deterministic (no wall-clock waits). clock.tickAsync advances both
         * timers and the microtask/immediate queue, so the recovery's own
         * connect handshake (setImmediate) resolves under the fake clock.
         * ---------------------------------------------------------- */

        describe("socket-loss recovery", function () {
            /*
             * Register + connect a publisher whose socket.connect() hands out a
             * fresh FakeSocket per call (so a recovery opens a new socket we can
             * inspect). Runs entirely on the REAL clock and resolves once the
             * first socket is live; the caller installs a fake clock afterwards
             * to drive the recovery deterministically.
             */
            async function recoverablePub(opts) {
                opts = opts || {};
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                let watchPubCalls = 0;
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/watchPub") {
                        watchPubCalls += 1;
                        return Promise.resolve({
                            watchId:
                                watchPubCalls === 1
                                    ? TEST_WATCH_ID
                                    : "fresh-watch-" + watchPubCalls,
                            data: [],
                        });
                    }
                    return Promise.resolve();
                });

                const sockets = [];
                const socketFactory = opts.socketFactory
                    || (() => new FakeSocket());
                sinon.stub(socket, "connect").callsFake(() => {
                    const s = socketFactory(sockets.length);
                    sockets.push(s);
                    return s;
                });
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher(opts.publisherOpts);
                await pub.watchPub({
                    data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                });
                await pub.connect(TEST_WATCH_ID, opts.connectOpts);
                return { pub, ws, sockets, watchPubCount: () => watchPubCalls };
            }

            it("should re-register fresh on a disconnect after registration", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub();
                expect(watchPubCount()).to.equal(1);

                const clock = sinon.useFakeTimers();
                try {
                    const reregistered = [];
                    const recovering = [];
                    pub.on("reregistered", (res) => reregistered.push(res));
                    pub.on("recovering", (r) => recovering.push(r));

                    /* Clean apiserver restart: the socket drops with a plain
                     * disconnect and never rejoins. */
                    sockets[0].serverEmit("disconnect", "transport close");

                    /* Wait out the disconnect grace + the recovery. */
                    await clock.tickAsync(1100);

                    /* A FRESH watchPub (no watchId) re-opened the watch. */
                    expect(watchPubCount()).to.equal(2);
                    const recoveryBody = pub._lastPubBody;
                    expect(recoveryBody.data).to.deep.equal([
                        { id: TEST_POINTS[0], intervalFast: 1000 },
                    ]);
                    /* A second socket was opened and is the live one. */
                    expect(sockets.length).to.equal(2);
                    expect(pub.socket).to.equal(sockets[1]);
                    expect(recovering).to.have.length(1);
                    expect(reregistered).to.have.length(1);

                    /* A post-recovery pointUpdate lands on the NEW socket and not
                     * the dead one (kai-5: prove the new socket is live). */
                    pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }]);
                    expect(sockets[1].sent.length).to.equal(1);
                    expect(sockets[0].sent.length).to.equal(0);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should re-register fresh (immediately) on a connect_error", async function () {
                const { pub, ws, sockets, watchPubCount } = await recoverablePub();

                const clock = sinon.useFakeTimers();
                try {
                    const reregistered = [];
                    pub.on("reregistered", (res) => reregistered.push(res));

                    /* A failed reconnection attempt against the dead namespace. */
                    sockets[0].serverEmit("connect_error", "Invalid namespace");

                    await clock.tickAsync(1);

                    expect(watchPubCount()).to.equal(2);
                    /* The recovery watchPub REQUEST must carry no stale watchId. */
                    const recoveryBody = ws._wsRawSubmit
                        .getCalls()
                        .filter((c) => c.args[1] === "/api/watchPub")
                        .pop().args[2];
                    expect(recoveryBody.watchId).to.equal(undefined);
                    expect(sockets.length).to.equal(2);
                    expect(pub.socket).to.equal(sockets[1]);
                    expect(reregistered).to.have.length(1);

                    /* kai-5: the recovered socket is the live one. */
                    pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 2 }]);
                    expect(sockets[1].sent.length).to.equal(1);
                    expect(sockets[0].sent.length).to.equal(0);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should emit 'reregister' alongside 'reregistered' so app handlers resync", async function () {
                const { pub, sockets } = await recoverablePub();

                const clock = sinon.useFakeTimers();
                try {
                    const reregister = [];
                    const reregistered = [];
                    pub.on("reregister", (res) => reregister.push(res));
                    pub.on("reregistered", (res) => reregistered.push(res));

                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    expect(reregister).to.have.length(1);
                    expect(reregistered).to.have.length(1);
                    expect(reregister[0]).to.equal(reregistered[0]);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should tear the dead socket down before re-registering", async function () {
                const { pub, sockets } = await recoverablePub();

                const dead = sockets[0];
                const closeSpy = sinon.spy(dead, "close");
                const disconnectSpy = sinon.spy(dead, "disconnect");

                const clock = sinon.useFakeTimers();
                try {
                    dead.serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    expect(disconnectSpy.called).to.equal(true);
                    expect(closeSpy.called).to.equal(true);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should never run more than one live socket across failed recovery iterations", async function () {
                /* Every recovery socket (sockets index >= 1) fails its open with a
                 * connect_error, so the recovery loop iterates several times. Each
                 * failed iteration must tear its socket down: at no observed point
                 * may two live (un-disconnected) sockets coexist. */
                const { pub, sockets } = await recoverablePub({
                    socketFactory: (idx) =>
                        idx === 0 ? new FakeSocket() : new FailOpenSocket(),
                });

                const clock = sinon.useFakeTimers();
                try {
                    const liveCounts = [];
                    pub.on("reregisterError", () => {
                        liveCounts.push(
                            sockets.filter((s) => s.isLive()).length);
                    });

                    /* Kick recovery; let it churn through several failed backoff
                     * iterations (1s, 2s, 4s, 8s, 16s). */
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1 + 1000 + 2000 + 4000 + 8000 + 16000);

                    /* The loop ran several iterations (one error per failure). */
                    expect(liveCounts.length).to.be.greaterThan(2);
                    /* INVARIANT: at most one live socket at any observed point. */
                    for (const c of liveCounts) {
                        expect(c).to.be.lessThan(2);
                    }
                    /* And right now, across every socket ever opened, at most one
                     * is still live. */
                    const liveNow = sockets.filter((s) => s.isLive()).length;
                    expect(liveNow).to.be.lessThan(2);

                    /* Stop the loop so close() does not race the next backoff. */
                    pub._closed = true;
                    await clock.tickAsync(30000);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should coalesce a burst of loss events into one recovery", async function () {
                const { pub, ws, sockets } = await recoverablePub();

                const clock = sinon.useFakeTimers();
                try {
                    /* Slow the recovery watchPub so the burst overlaps it. */
                    let resolveWatchPub;
                    let recoveryWatchPubs = 0;
                    ws._wsRawSubmit = sinon.spy((method, uri) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/watchPub") {
                            recoveryWatchPubs += 1;
                            return new Promise((resolve) => {
                                resolveWatchPub = () =>
                                    resolve({ watchId: "wp-recovered", data: [] });
                            });
                        }
                        return Promise.resolve();
                    });

                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    sockets[0].serverEmit("disconnect", "transport close");
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    /* Only one recovery watchPub is in flight despite three events. */
                    expect(recoveryWatchPubs).to.equal(1);
                    resolveWatchPub();
                    await clock.tickAsync(1);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should retry recovery with backoff until watchPub is accepted", async function () {
                const { pub, ws } = await recoverablePub();

                const clock = sinon.useFakeTimers();
                try {
                    /* The first recovery watchPub fails (apiserver still
                     * settling), the second succeeds. */
                    let recoveryCalls = 0;
                    ws._wsRawSubmit = sinon.spy((method, uri) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/watchPub") {
                            recoveryCalls += 1;
                            if (recoveryCalls === 1) {
                                return Promise.reject(
                                    new Error("service unavailable"));
                            }
                            return Promise.resolve({
                                watchId: "wp-recovered", data: [] });
                        }
                        return Promise.resolve();
                    });

                    const reregistered = [];
                    pub.on("reregistered", (res) => reregistered.push(res));

                    pub.socket.serverEmit("connect_error", "Invalid namespace");

                    /* Allow the failed attempt + 1 s backoff + the retry. */
                    await clock.tickAsync(1300);

                    expect(recoveryCalls).to.equal(2);
                    expect(reregistered).to.have.length(1);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should not recover before the first registration / connect", async function () {
                const clock = sinon.useFakeTimers();
                try {
                    const http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    ws._wsRawSubmit = sinon.spy((method, uri) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        return Promise.resolve({ watchId: TEST_WATCH_ID, data: [] });
                    });

                    const pub = ws.createPublisher();
                    /* A loss before any connect() is a no-op (no socket, not
                     * connected). Drive the session's own handler directly. */
                    pub._scheduleRecovery("transport close");
                    pub._recover("connect_error");
                    await clock.tickAsync(50);

                    const watchPubs = ws._wsRawSubmit
                        .getCalls()
                        .filter((c) => c.args[1] === "/api/watchPub").length;
                    expect(watchPubs).to.equal(0);
                } finally {
                    clock.restore();
                }
            });

            it("should not recover after close", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub();
                const before = watchPubCount();

                await pub.close();

                const clock = sinon.useFakeTimers();
                try {
                    /* A late socket loss after close must not re-register. */
                    sockets[0].serverEmit("disconnect", "transport close");
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1100);

                    expect(watchPubCount()).to.equal(before);
                } finally {
                    clock.restore();
                }
            });

            it("should not recover when autoRecover is disabled", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub({
                    publisherOpts: { autoRecover: false },
                });
                const before = watchPubCount();

                const clock = sinon.useFakeTimers();
                try {
                    sockets[0].serverEmit("disconnect", "transport close");
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1100);

                    expect(watchPubCount()).to.equal(before);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });

            it("should let a within-grace rejoin cancel a pending recovery (no REST)", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub();
                const before = watchPubCount();

                const clock = sinon.useFakeTimers();
                try {
                    /* Transient drop, then socket.io rejoins within the grace
                     * window: the pending recovery is cancelled, no fresh
                     * watchPub. */
                    sockets[0].serverEmit("disconnect", "transport close");
                    sockets[0].serverEmit("connect");
                    await clock.tickAsync(1100);

                    expect(watchPubCount()).to.equal(before);
                    expect(sockets.length).to.equal(1);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });
        });


        /* ------------------------------------------------------------
         * Teardown: no lingering sockets / listeners
         * ---------------------------------------------------------- */

        describe("close", function () {
            it("should disconnect and close the socket and drop listeners", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.connect(TEST_WATCH_ID);
                pub.on("pointCadence", () => {});

                await pub.close();

                expect(fake.disconnected).to.equal(true);
                expect(fake.closed).to.equal(true);
                expect(pub.socket).to.equal(null);
                expect(pub.listenerCount("pointCadence")).to.equal(0);
            });

            it("should issue watchUnpub when close({ unpub: true })", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                pub.watchId = TEST_WATCH_ID;
                await pub.connect(TEST_WATCH_ID);

                await pub.close({ unpub: true });

                const unpubCall = ws._wsRawSubmit
                    .getCalls()
                    .find((c) => c.args[1] === "/api/watchUnpub");
                expect(unpubCall).to.not.equal(undefined);
                expect(unpubCall.args[2]).to.deep.equal({
                    watchId: TEST_WATCH_ID,
                });
            });

            it("should suppress re-register after close", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.resolve({ watchId: TEST_WATCH_ID, data: [] });
                });

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.watchPub({
                    data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                });
                await pub.connect(TEST_WATCH_ID);

                await pub.close();

                const callsBefore = ws._wsRawSubmit.callCount;
                /* A late dead-namespace signal after close must do nothing. */
                fake.serverEmit("pointUpdateError", {
                    command: "pointUpdateError",
                    err: "gone",
                    errorCode: 404,
                });
                await new Promise((r) => setImmediate(r));

                expect(ws._wsRawSubmit.callCount).to.equal(callsBefore);
            });
        });
    });
});
