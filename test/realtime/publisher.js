/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for the realtime publisher session (CORE-8664).
 *
 * HTTP is stubbed via StubHTTPClient (no live server); sockets are stubbed by
 * replacing socket.io-client's connect() with a fake EventEmitter socket so the
 * handshake args, outbound pointUpdate frames, and inbound event dispatch can be
 * asserted without a real connection.
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
const PublisherSession = require("../../src/client/publisher");

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
    emit(event, payload, ack) {
        /* 'message'/pointUpdate is outbound; local lifecycle events still need
         * EventEmitter semantics for our own listeners, but the publisher only
         * ever sends 'message' frames via emit(), so record those. */
        if (event === "message") {
            /* The acknowledgement callback is recorded, never auto-invoked
             * (CORE-9226 #159). A test decides when, whether and with what the
             * server answers -- including deciding that it never answers at
             * all, which is the pre-#159 server every deployment is running
             * today and the case the client's timeout exists for. */
            this.sent.push({ event, payload, ack });
            return true;
        }
        return super.emit(event, payload);
    }

    /** Answer the Nth recorded frame the way a server would. */
    serverAck(payload, index = this.sent.length - 1) {
        const frame = this.sent[index];
        if (!frame || typeof frame.ack !== "function") {
            throw new Error("frame " + index + " was emitted without an ack");
        }
        frame.ack(payload);
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
                        reconnectionDelay: 5000,
                        reconnectionDelayMax: 300000,
                        randomizationFactor: 0.5,
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
         * pointUpdate acknowledgement (CORE-9226 #159)
         *
         * Per-call by design, and NOT a compatibility switch. A caller
         * publishing HISTORY always asks for the acknowledgement; a CUR frame
         * never does, because the next tick supersedes it. So the two-argument
         * path must stay byte-identical -- same emit, same arity, same
         * undefined return -- for cur's sake, not for an old server's.
         * ---------------------------------------------------------- */

        describe("pointUpdate acknowledgement (CORE-9226 #159)", function () {
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

            it("emits with NO ack argument and returns undefined by default", async function () {
                /* Stated as arity, because that is where it is decided: the
                 * server can only answer a frame socket.io allocated an ack id
                 * for, and it allocates one only when the client passes a
                 * callback. This is what keeps a cur frame unanswered. */
                const { pub, fake } = await connectedPub();

                const returned = pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }]);

                expect(returned).to.equal(undefined);
                expect(fake.sent).to.have.length(1);
                expect(fake.sent[0].ack).to.equal(undefined);
            });

            it("resolves 'ack' with the applied count when the server acks", async function () {
                const { pub, fake } = await connectedPub();

                const pending = pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }], {
                    ack: true,
                });
                fake.serverAck({ ok: true, applied: 1 });

                expect(await pending).to.deep.equal({ status: "ack", applied: 1 });
            });

            it("resolves 'ack' when the server stored NOTHING but declined on purpose", async function () {
                /* {ok: true, applied: 0} is a real answer, not a degenerate
                 * one. `ok` means the frame is RESOLVED and may be dropped,
                 * which is true both when everything stored and when the
                 * server's freshness guard correctly refused an older sample.
                 * A caller that read applied 0 as failure would re-send for
                 * ever a frame the server is right to refuse. */
                const { pub, fake } = await connectedPub();

                const pending = pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }], {
                    ack: true,
                });
                fake.serverAck({ ok: true, applied: 0 });

                expect(await pending).to.deep.equal({ status: "ack", applied: 0 });
            });

            it("resolves 'nack' carrying the failed points verbatim", async function () {
                /* failed[] is what the caller quarantines on, so it is passed
                 * through untouched rather than reshaped. */
                const { pub, fake } = await connectedPub();

                const pending = pub.pointUpdate(
                    [
                        { id: TEST_POINTS[0], curVal: 1 },
                        { id: TEST_POINTS[1], curVal: 2 },
                    ],
                    { ack: true }
                );
                fake.serverAck({
                    ok: false,
                    applied: 1,
                    failed: [{ id: TEST_POINTS[0], reason: "history-persist-failed" }],
                });

                expect(await pending).to.deep.equal({
                    status: "nack",
                    applied: 1,
                    failed: [{ id: TEST_POINTS[0], reason: "history-persist-failed" }],
                });
            });

            it("resolves 'unacked' rather than hanging when the server never answers", async function () {
                /* The reason the promise carries a deadline at all: a caller
                 * awaiting an answer that is not coming would be parked for
                 * ever, and a parked publisher stops publishing. 'unacked'
                 * means UNCONFIRMED and nothing else -- what the caller does
                 * with it is the caller's rule, and the only correct one is to
                 * keep the frame. */
                const { pub, fake } = await connectedPub();

                const pending = pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }], {
                    ack: true,
                    ackTimeoutMs: 5,
                });

                expect(fake.sent[0].ack).to.be.a("function");
                expect(await pending).to.deep.equal({ status: "unacked" });
            });

            it("ignores an ack that arrives AFTER the timeout already settled it", async function () {
                /* A late ack must not re-settle the promise. The caller has
                 * already treated the frame as unacknowledged and re-queued
                 * it; a second verdict on the same frame is how it would end
                 * up both retained and deleted. */
                const { pub, fake } = await connectedPub();

                const pending = pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }], {
                    ack: true,
                    ackTimeoutMs: 5,
                });
                const settled = await pending;
                fake.serverAck({ ok: true, applied: 1 });

                expect(settled).to.deep.equal({ status: "unacked" });
                expect(await pending).to.deep.equal({ status: "unacked" });
            });

            it("treats an unreadable ack payload as a nack, never as success", async function () {
                /* On a doubtful answer the one unsafe move is to drop the
                 * frame, so anything that is not a recognisable positive ack
                 * is reported as a nack. */
                const { pub, fake } = await connectedPub();

                const pending = pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }], {
                    ack: true,
                });
                fake.serverAck("not an object");

                expect(await pending).to.deep.equal({
                    status: "nack",
                    applied: 0,
                    failed: [],
                });
            });

            it("still throws synchronously when called before connect()", async function () {
                /* The pre-existing contract, re-pinned on the ack path: a
                 * precondition failure is a throw, not a resolved promise, so
                 * a caller cannot mistake it for a server verdict. */
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const pub = ws.createPublisher();

                expect(() =>
                    pub.pointUpdate([{ id: TEST_POINTS[0], curVal: 1 }], { ack: true })
                ).to.throw(/before connect/);
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

                /* A second socket was opened for the fresh namespace. */
                expect(sockets.length).to.equal(2);

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
         * ---------------------------------------------------------- */

        describe("socket-loss recovery", function () {
            /*
             * Register + connect a publisher whose socket.connect() hands out a
             * fresh FakeSocket per call (so a recovery opens a new socket we can
             * inspect). Resolves once the first socket is live.
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
                sinon.stub(socket, "connect").callsFake(() => {
                    const s = new FakeSocket();
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

            const settle = () => new Promise((r) => setImmediate(r));

            it("should re-register fresh on a disconnect after registration", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub();
                expect(watchPubCount()).to.equal(1);

                const reregistered = [];
                const recovering = [];
                pub.on("reregistered", (res) => reregistered.push(res));
                pub.on("recovering", (r) => recovering.push(r));

                /* Clean apiserver restart: the socket drops with a plain
                 * disconnect and never rejoins. */
                sockets[0].serverEmit("disconnect", "transport close");

                /* Wait out the disconnect grace + the recovery. */
                await new Promise((r) => setTimeout(r, 1100));
                await settle();

                /* A FRESH watchPub (no watchId) re-opened the watch. */
                expect(watchPubCount()).to.equal(2);
                const recoveryBody = pub._lastPubBody;
                expect(recoveryBody.data).to.deep.equal([
                    { id: TEST_POINTS[0], intervalFast: 1000 },
                ]);
                /* A second socket was opened. */
                expect(sockets.length).to.equal(2);
                expect(recovering).to.have.length(1);
                expect(reregistered).to.have.length(1);
                /* 'reregister' fires too so existing app handlers resync. */
                await pub.close();
            });

            it("should re-register fresh (immediately) on a connect_error", async function () {
                const { pub, ws, sockets, watchPubCount } = await recoverablePub();

                const reregistered = [];
                pub.on("reregistered", (res) => reregistered.push(res));

                /* A failed reconnection attempt against the dead namespace. */
                sockets[0].serverEmit("connect_error", "Invalid namespace");

                await settle();
                await settle();

                expect(watchPubCount()).to.equal(2);
                /* The recovery watchPub REQUEST must carry no stale watchId. */
                const recoveryBody = ws._wsRawSubmit
                    .getCalls()
                    .filter((c) => c.args[1] === "/api/watchPub")
                    .pop().args[2];
                expect(recoveryBody.watchId).to.equal(undefined);
                expect(sockets.length).to.equal(2);
                expect(reregistered).to.have.length(1);
                await pub.close();
            });

            it("should emit 'reregister' alongside 'reregistered' so app handlers resync", async function () {
                const { pub, sockets } = await recoverablePub();

                const reregister = [];
                const reregistered = [];
                pub.on("reregister", (res) => reregister.push(res));
                pub.on("reregistered", (res) => reregistered.push(res));

                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await settle();
                await settle();

                expect(reregister).to.have.length(1);
                expect(reregistered).to.have.length(1);
                expect(reregister[0]).to.equal(reregistered[0]);
                await pub.close();
            });

            it("should tear the dead socket down before re-registering", async function () {
                const { pub, sockets } = await recoverablePub();

                const dead = sockets[0];
                const closeSpy = sinon.spy(dead, "close");
                const disconnectSpy = sinon.spy(dead, "disconnect");

                dead.serverEmit("connect_error", "Invalid namespace");
                await settle();
                await settle();

                expect(disconnectSpy.called).to.equal(true);
                expect(closeSpy.called).to.equal(true);
                await pub.close();
            });

            it("should coalesce a burst of loss events into one recovery", async function () {
                const { pub, ws, sockets } = await recoverablePub();

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
                await settle();

                /* Only one recovery watchPub is in flight despite three events. */
                expect(recoveryWatchPubs).to.equal(1);
                resolveWatchPub();
                await settle();
                await pub.close();
            });

            it("should retry recovery with backoff until watchPub is accepted", async function () {
                const { pub, ws } = await recoverablePub();

                /* The first recovery watchPub fails (apiserver still settling),
                 * the second succeeds. */
                let recoveryCalls = 0;
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/watchPub") {
                        recoveryCalls += 1;
                        if (recoveryCalls === 1) {
                            return Promise.reject(new Error("service unavailable"));
                        }
                        return Promise.resolve({ watchId: "wp-recovered", data: [] });
                    }
                    return Promise.resolve();
                });

                const reregistered = [];
                pub.on("reregistered", (res) => reregistered.push(res));

                pub.socket.serverEmit("connect_error", "Invalid namespace");

                /* Allow the failed attempt + 1 s backoff + the retry. */
                await new Promise((r) => setTimeout(r, 1300));

                expect(recoveryCalls).to.equal(2);
                expect(reregistered).to.have.length(1);
                await pub.close();
            });

            it("should not recover before the first registration / connect", async function () {
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
                await new Promise((r) => setTimeout(r, 50));

                const watchPubs = ws._wsRawSubmit
                    .getCalls()
                    .filter((c) => c.args[1] === "/api/watchPub").length;
                expect(watchPubs).to.equal(0);
            });

            it("should not recover after close", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub();
                const before = watchPubCount();

                await pub.close();

                /* A late socket loss after close must not re-register. */
                sockets[0].serverEmit("disconnect", "transport close");
                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await new Promise((r) => setTimeout(r, 1100));

                expect(watchPubCount()).to.equal(before);
            });

            it("should not recover when autoRecover is disabled", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub({
                    publisherOpts: { autoRecover: false },
                });
                const before = watchPubCount();

                sockets[0].serverEmit("disconnect", "transport close");
                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await new Promise((r) => setTimeout(r, 1100));

                expect(watchPubCount()).to.equal(before);
                await pub.close();
            });

            it("should let a within-grace rejoin cancel a pending recovery (no REST)", async function () {
                const { pub, sockets, watchPubCount } = await recoverablePub();
                const before = watchPubCount();

                /* Transient drop, then socket.io rejoins within the grace window:
                 * the pending recovery is cancelled, no fresh watchPub. */
                sockets[0].serverEmit("disconnect", "transport close");
                sockets[0].serverEmit("connect");
                await new Promise((r) => setTimeout(r, 1100));

                expect(watchPubCount()).to.equal(before);
                expect(sockets.length).to.equal(1);
                await pub.close();
            });
        });

        /* ------------------------------------------------------------
         * Recovery robustness (CORE-8790, kai-1 / kai-2 review findings). A
         * throwing 'recovering' listener must not wedge the guard flag
         * forever (kai-1), and a hung recovery REST call must not wedge the
         * retry loop forever either (kai-2). Both are permanent-silent-wedge
         * bugs on an unattended device: exactly the failure class this PR
         * exists to prevent.
         * ---------------------------------------------------------- */

        describe("recovery robustness (CORE-8790)", function () {
            const settle = () => new Promise((r) => setImmediate(r));

            describe("kai-1: throwing 'recovering' listener", function () {
                it("must not wedge _recovering forever (socket-loss _recover)", async function () {
                    let http = new stubs.StubHTTPClient(),
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
                    sinon.stub(socket, "connect").callsFake(() => {
                        const s = new FakeSocket();
                        sockets.push(s);
                        return s;
                    });
                    sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                    const pub = ws.createPublisher();
                    await pub.watchPub({
                        data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                    });
                    await pub.connect(TEST_WATCH_ID);

                    const boom = new Error("listener boom");
                    pub.on("recovering", () => {
                        throw boom;
                    });

                    const reregistered = [];
                    pub.on("reregistered", (res) => reregistered.push(res));

                    /* A failed reconnection attempt against the dead namespace
                     * fires _recover() synchronously, which now emits
                     * 'recovering' INSIDE the try/finally: the listener above
                     * throws immediately. */
                    sockets[0].serverEmit("connect_error", "Invalid namespace");

                    await settle();
                    await settle();
                    await settle();

                    /* (a) the guard flag must clear, not stay wedged true. */
                    expect(pub._recovering).to.equal(false);
                    /* (b) recovery proceeded despite the throw: a fresh
                     * watchPub ran and the session resynced. */
                    expect(watchPubCalls).to.equal(2);
                    expect(reregistered).to.have.length(1);
                    /* The listener's own throw is logged loudly, not eaten. */
                    const loggedErrors = log.error.getCalls().map((c) => c.args[0]);
                    expect(loggedErrors).to.include(boom);

                    /* A SUBSEQUENT recovery is not permanently disabled. */
                    sockets[1].serverEmit("connect_error", "Invalid namespace");
                    await settle();
                    await settle();
                    await settle();

                    expect(pub._recovering).to.equal(false);
                    expect(watchPubCalls).to.equal(3);
                    expect(reregistered).to.have.length(2);

                    await pub.close();
                });
            });

            describe("kai-2: recovery REST calls must not hang forever", function () {
                it("times out a hung recovery watchPub and moves on to the next backoff attempt (_recover)", async function () {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    let watchPubCalls = 0;
                    const recoveryConfigs = [];
                    ws._wsRawSubmit = sinon.spy((method, uri, body, config) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/watchPub") {
                            watchPubCalls += 1;
                            if (watchPubCalls === 1) {
                                return Promise.resolve({ watchId: TEST_WATCH_ID, data: [] });
                            }
                            recoveryConfigs.push(config);
                            if (watchPubCalls === 2) {
                                /* Simulate a half-open TCP flow (dead, no
                                 * RST): only a real per-call timeout unwedges
                                 * it. Mirrors axios's own req.setTimeout
                                 * behaviour so the test can drive it
                                 * deterministically with sinon's fake clock. */
                                return new Promise((resolve, reject) => {
                                    if (config && config.timeout) {
                                        setTimeout(() => {
                                            reject(new Error(
                                                `timeout of ${config.timeout}ms exceeded`));
                                        }, config.timeout);
                                        return;
                                    }
                                    /* No timeout configured: hangs forever
                                     * (the bug, pre-fix). */
                                });
                            }
                            /* Third+ attempt: we only need to observe the
                             * loop REACHING it, proving call #2 did not hang
                             * forever. Never settling here keeps the test
                             * from depending on the follow-on connect()
                             * socket handshake. */
                            return new Promise(() => {});
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
                    await pub.watchPub({
                        data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                    });
                    await pub.connect(TEST_WATCH_ID);

                    const clock = sinon.useFakeTimers();
                    try {
                        const reregisterErrors = [];
                        pub.on("reregisterError", (err) => reregisterErrors.push(err));

                        sockets[0].serverEmit("connect_error", "Invalid namespace");

                        /* Reach the hung recovery watchPub. */
                        await clock.tickAsync(0);
                        expect(watchPubCalls).to.equal(2);
                        expect(pub._recovering).to.equal(true);
                        /* Pin the literal wire value: pre-fix both sides
                         * would be undefined and this would pass vacuously. */
                        expect(recoveryConfigs[0].timeout).to.equal(45000);
                        expect(recoveryConfigs[0].timeout).to.equal(
                            PublisherSession.RECOVERY_REQUEST_TIMEOUT_MS);

                        /* Advance past the recovery-request timeout: pre-fix
                         * this await hangs forever; post-fix it rejects. */
                        await clock.tickAsync(
                            PublisherSession.RECOVERY_REQUEST_TIMEOUT_MS + 1);
                        expect(reregisterErrors).to.have.length(1);
                        expect(reregisterErrors[0].message).to.match(/timeout/);

                        /* Advance past the jittered backoff: the loop
                         * proceeds to its NEXT attempt rather than hanging
                         * forever. */
                        await clock.tickAsync(
                            PublisherSession.RECOVER_MAX_BACKOFF_MS + 1);
                        expect(watchPubCalls).to.equal(3);
                    }
                    finally {
                        clock.restore();
                    }

                    await pub.close();
                });

                it("times out a hung dead-namespace re-register (_maybeReregister)", async function () {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    let watchPubCalls = 0;
                    const recoveryConfigs = [];
                    ws._wsRawSubmit = sinon.spy((method, uri, body, config) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/watchPub") {
                            watchPubCalls += 1;
                            if (watchPubCalls === 1) {
                                return Promise.resolve({ watchId: TEST_WATCH_ID, data: [] });
                            }
                            recoveryConfigs.push(config);
                            /* The dead-namespace re-register: a half-open TCP
                             * flow, only the per-call timeout unwedges it. */
                            return new Promise((resolve, reject) => {
                                if (config && config.timeout) {
                                    setTimeout(() => {
                                        reject(new Error(
                                            `timeout of ${config.timeout}ms exceeded`));
                                    }, config.timeout);
                                    return;
                                }
                            });
                        }
                        return Promise.resolve();
                    });

                    const fake = new FakeSocket();
                    sinon.stub(socket, "connect").returns(fake);
                    sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                    const pub = ws.createPublisher();
                    await pub.watchPub({
                        data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                    });
                    await pub.connect(TEST_WATCH_ID);

                    const clock = sinon.useFakeTimers();
                    try {
                        const reregisterErrors = [];
                        pub.on("reregisterError", (err) => reregisterErrors.push(err));

                        /* Dead namespace: server says 404 on a pointUpdate. */
                        fake.serverEmit("pointUpdateError", {
                            command: "pointUpdateError",
                            err: "Namespace does not map to an active publisher watch owned by this user",
                            errorCode: 404,
                        });

                        await clock.tickAsync(0);
                        expect(watchPubCalls).to.equal(2);
                        expect(pub._reregistering).to.equal(true);
                        /* Pin the literal wire value: pre-fix both sides
                         * would be undefined and this would pass vacuously. */
                        expect(recoveryConfigs[0].timeout).to.equal(45000);
                        expect(recoveryConfigs[0].timeout).to.equal(
                            PublisherSession.RECOVERY_REQUEST_TIMEOUT_MS);

                        await clock.tickAsync(
                            PublisherSession.RECOVERY_REQUEST_TIMEOUT_MS + 1);

                        expect(reregisterErrors).to.have.length(1);
                        expect(reregisterErrors[0].message).to.match(/timeout/);
                        expect(pub._reregistering).to.equal(false);
                    }
                    finally {
                        clock.restore();
                    }

                    await pub.close();
                });
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
