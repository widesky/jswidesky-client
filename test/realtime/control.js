/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for the realtime control-command listener session (CORE-8664).
 *
 * HTTP is stubbed via StubHTTPClient (no live server); sockets are stubbed by
 * replacing socket.io-client's connect() with a fake EventEmitter socket so the
 * handshake args, outbound reportWrite frames, and inbound command dispatch can
 * be asserted without a real connection.
 */
"use strict";

const socket = require("socket.io-client"),
    stubs = require("../stubs"),
    expect = require("chai").expect,
    sinon = require("sinon"),
    EventEmitter = require("events"),
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const { verifyRequestCall } = require("../client/utils");
const ControlSession = require("../../src/client/control");
const { validate: uuidValidate } = require("uuid");

const TEST_POINTS = [
    "00000000-0001-0001-0001-000000000000",
    "00000000-0001-0001-0001-000000000001",
    "00000000-0001-0001-0001-000000000002",
];
const TEST_REG_ID = "33333333-aaa1-bbb1-ccc1-444444444444";

/**
 * A fake socket.io-client socket: an EventEmitter with the surface the control
 * session touches. A control-listener namespace resolves the open handshake on
 * the WideSkyConnected event (not 'connect'), so open() fires that.
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

    emit(event, payload) {
        if (event === "message") {
            this.sent.push({ event, payload });
            return true;
        }
        return super.emit(event, payload);
    }

    open() {
        this.opened = true;
        /* Mimic the listener namespace firing WideSkyConnected after open(). */
        setImmediate(() => {
            this.connected = true;
            super.emit("WideSkyConnected", { success: 200 });
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

    /* Drive an inbound server-to-listener event in a test. */
    serverEmit(event, payload) {
        super.emit(event, payload);
    }
}

/** A controlSub stub that resolves a standalone (non-shared) registration. */
function stubStandalone(ws, regId) {
    ws._wsRawSubmit = sinon.spy((method, uri) => {
        if (uri === "/oauth2/token") {
            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
        }
        if (uri === "/api/controlSub") {
            return Promise.resolve({
                registrationId: regId || TEST_REG_ID,
                shared: false,
                data: [],
            });
        }
        return Promise.resolve();
    });
}

describe("Realtime", function () {
    describe("control", function () {
        beforeEach(() => {
            sinon.restore();
        });

        /* ------------------------------------------------------------
         * controlSub / controlUnsub request shapes
         * ---------------------------------------------------------- */

        describe("controlSub", function () {
            it("should POST a { data:[{id}] } body verbatim", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const ctl = ws.createControlListener();
                const body = {
                    data: [{ id: TEST_POINTS[0] }, { id: TEST_POINTS[1] }],
                };

                await ctl.controlSub(body);

                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "POST",
                    "/api/controlSub",
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

            it("should wrap an array of bare ids into { data:[{id}] }", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const ctl = ws.createControlListener();
                await ctl.controlSub([TEST_POINTS[0], TEST_POINTS[1]]);

                expect(ws._wsRawSubmit.secondCall.args[2]).to.deep.equal({
                    data: [{ id: TEST_POINTS[0] }, { id: TEST_POINTS[1] }],
                });
            });

            it("should wrap a single bare id into { data:[{id}] }", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const ctl = ws.createControlListener();
                await ctl.controlSub(TEST_POINTS[0]);

                expect(ws._wsRawSubmit.secondCall.args[2]).to.deep.equal({
                    data: [{ id: TEST_POINTS[0] }],
                });
            });

            it("should stash registrationId and shared flag from the response", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                stubStandalone(ws);

                const ctl = ws.createControlListener();
                const res = await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });

                expect(res.registrationId).to.equal(TEST_REG_ID);
                expect(ctl.registrationId).to.equal(TEST_REG_ID);
                expect(ctl.shared).to.equal(false);
            });

            it("should record shared:true when the server returns it", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.resolve({
                        registrationId: TEST_REG_ID,
                        shared: true,
                        data: [],
                    });
                });

                const ctl = ws.createControlListener();
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });

                expect(ctl.shared).to.equal(true);
            });
        });

        describe("controlUnsub", function () {
            it("should POST { registrationId } for the stashed registration", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const ctl = ws.createControlListener();
                ctl.registrationId = TEST_REG_ID;

                await ctl.controlUnsub();

                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "POST",
                    "/api/controlUnsub",
                    { registrationId: TEST_REG_ID },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json",
                        },
                        decompress: true,
                    }
                );
            });

            it("should POST { registrationId } for an explicit id", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const ctl = ws.createControlListener();
                await ctl.controlUnsub("99999999-aaa1-bbb1-ccc1-444444444444");

                expect(ws._wsRawSubmit.secondCall.args[2]).to.deep.equal({
                    registrationId: "99999999-aaa1-bbb1-ccc1-444444444444",
                });
            });
        });

        /* ------------------------------------------------------------
         * Standalone connect handshake (WideSkyConnected open event)
         * ---------------------------------------------------------- */

        describe("connect handshake (standalone)", function () {
            it("should connect with the token in the query like watch sockets", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener();
                await ctl.connect(TEST_REG_ID);

                expect(socket.connect.callCount).to.equal(1);
                expect(socket.connect.getCall(0).args).to.eql([
                    `http://localhost:3000/${TEST_REG_ID}`,
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

            it("should resolve on WideSkyConnected and emit 'connect'", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener();
                const connects = [];
                ctl.on("connect", () => connects.push(true));

                await ctl.connect(TEST_REG_ID);

                expect(connects).to.have.length(1);
            });

            it("should default to the controlSub-assigned registrationId", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener();
                ctl.registrationId = TEST_REG_ID;
                await ctl.connect();

                expect(socket.connect.getCall(0).args[0]).to.equal(
                    `http://localhost:3000/${TEST_REG_ID}`
                );
            });

            it("should reject connect() with no registrationId", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const ctl = ws.createControlListener();
                let threw = false;
                try {
                    await ctl.connect();
                } catch (err) {
                    threw = true;
                    expect(err.message).to.match(/registrationId/);
                }
                expect(threw).to.equal(true);
            });

            it("should reject when the socket reports connection_error", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                fake.open = function () {
                    this.opened = true;
                    setImmediate(() =>
                        EventEmitter.prototype.emit.call(
                            this,
                            "connection_error",
                            "Forbidden"
                        )
                    );
                };
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener({ autoRecover: false });
                let reason = null;
                try {
                    await ctl.connect(TEST_REG_ID);
                } catch (err) {
                    reason = err;
                }
                expect(reason).to.equal("Forbidden");
            });

            it("carries an asynchronously-acquired token into the handshake (CORE-9226 review N1)", async function () {
                /* getToken() is a PROMISE whenever acquisition is in flight;
                 * reading `.access_token` off it synchronously sent the
                 * handshake out as `Authorization: undefined`. Mirror of the
                 * publisher-side test; both socket entry points share the
                 * defect and the fix. */
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").resolves({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener();
                await ctl.connect(TEST_REG_ID);

                expect(
                    socket.connect.getCall(0).args[1].query.Authorization,
                    "a handshake must never leave with Authorization: undefined"
                ).to.equal(WS_ACCESS_TOKEN);
            });

            it("rejects connect() when acquisition fails, before any socket exists (CORE-9226 review N1)", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                const denial = new Error("login failed: bad credentials");
                sinon.stub(ws, "getToken").rejects(denial);

                const ctl = ws.createControlListener({ autoRecover: false });
                let err = null;
                try {
                    await ctl.connect(TEST_REG_ID);
                } catch (e) {
                    err = e;
                }

                expect(err, "connect() must surface the acquisition error")
                    .to.equal(denial);
                expect(
                    socket.connect.callCount,
                    "no handshake may be attempted without a credential"
                ).to.equal(0);
            });
        });

        /* ------------------------------------------------------------
         * Inbound: pointWrite command dispatch
         * ---------------------------------------------------------- */

        describe("command dispatch (standalone)", function () {
            async function connectedCtl() {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });
                const ctl = ws.createControlListener({ autoRecover: false });
                await ctl.connect(TEST_REG_ID);
                return { ctl, fake };
            }

            it("should emit 'command' for an inbound pointWrite message", async function () {
                const { ctl, fake } = await connectedCtl();

                const commands = [];
                ctl.on("command", (c) => commands.push(c));

                fake.serverEmit("message", {
                    command: "pointWrite",
                    requestId: "req-1",
                    data: [{ id: TEST_POINTS[0], writeVal: 42 }],
                    timeout: 5000,
                });

                expect(commands).to.have.length(1);
                expect(commands[0].requestId).to.equal("req-1");
                expect(commands[0].data).to.deep.equal([
                    { id: TEST_POINTS[0], writeVal: 42 },
                ]);
            });

            it("should ignore a non-pointWrite message frame", async function () {
                const { ctl, fake } = await connectedCtl();

                const commands = [];
                ctl.on("command", (c) => commands.push(c));

                /* A reportWrite echo / other frame is not a command. */
                fake.serverEmit("message", {
                    command: "reportWrite",
                    requestId: "req-1",
                    data: [],
                    done: true,
                });

                expect(commands).to.have.length(0);
            });
        });

        /* ------------------------------------------------------------
         * Outbound: reportWrite reply
         * ---------------------------------------------------------- */

        describe("reportWrite (standalone)", function () {
            async function connectedCtl() {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });
                const ctl = ws.createControlListener({ autoRecover: false });
                await ctl.connect(TEST_REG_ID);
                return { ctl, fake };
            }

            it("should emit a reportWrite frame settling a request", async function () {
                const { ctl, fake } = await connectedCtl();

                ctl.reportWrite("req-1", [
                    { id: TEST_POINTS[0], writeVal: 42, writeStatus: "ok" },
                ]);

                expect(fake.sent.length).to.equal(1);
                expect(fake.sent[0].event).to.equal("message");
                const frame = fake.sent[0].payload;
                /* responseId is a freshly generated uuid (required by the command
                 * router and distinct from requestId), so assert its shape, not a
                 * fixed value. */
                expect(uuidValidate(frame.responseId),
                    "responseId is a uuid").to.be.true;
                expect(frame.responseId).to.not.equal(frame.requestId);
                delete frame.responseId;
                expect(frame).to.deep.equal({
                    command: "reportWrite",
                    requestId: "req-1",
                    data: [{ id: TEST_POINTS[0], writeVal: 42, writeStatus: "ok" }],
                    done: true,
                });
            });

            it("should wrap a single result object in an array", async function () {
                const { ctl, fake } = await connectedCtl();

                ctl.reportWrite("req-1", {
                    id: TEST_POINTS[0],
                    writeStatus: "ok",
                });

                expect(fake.sent[0].payload.data).to.deep.equal([
                    { id: TEST_POINTS[0], writeStatus: "ok" },
                ]);
            });

            it("should honour done:false for a partial reply", async function () {
                const { ctl, fake } = await connectedCtl();

                ctl.reportWrite("req-1", [{ id: TEST_POINTS[0], writeStatus: "ok" }],
                    { done: false });

                expect(fake.sent[0].payload.done).to.equal(false);
            });

            it("should throw if called before connect()", function () {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                const ctl = ws.createControlListener();

                expect(() =>
                    ctl.reportWrite("req-1", [{ id: TEST_POINTS[0] }])
                ).to.throw(/before connect/);
            });
        });

        /* ------------------------------------------------------------
         * Shared transport (reuse an owning publisher's socket)
         * ---------------------------------------------------------- */

        describe("shared transport", function () {
            /* A minimal fake PublisherSession exposing the surface ControlSession
             * touches: a connected socket whose 'message' frames carry control. */
            function fakePublisher() {
                const pubSocket = new FakeSocket();
                pubSocket.connected = true;
                return { socket: pubSocket };
            }

            async function sharedCtl(opts) {
                opts = opts || {};
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.resolve({
                        registrationId: TEST_REG_ID,
                        shared: true,
                        data: [],
                    });
                });

                /* socket.connect must NOT be called for the shared transport. */
                const connectSpy = sinon.stub(socket, "connect");

                const publisher = fakePublisher();
                const ctl = opts.viaOption
                    ? ws.createControlListener({ publisher })
                    : ws.createControlListener().attachTo(publisher);

                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                const ret = await ctl.connect();
                return { ctl, publisher, connectSpy, ret };
            }

            it("should reuse the publisher socket and open none of its own", async function () {
                const { ctl, connectSpy, ret } = await sharedCtl();

                expect(ctl.shared).to.equal(true);
                expect(ctl.socket).to.equal(null);
                expect(ret).to.equal(null);
                /* No standalone socket was opened. */
                expect(connectSpy.callCount).to.equal(0);
            });

            it("should accept the publisher via the constructor option", async function () {
                const { ctl, connectSpy } = await sharedCtl({ viaOption: true });

                expect(ctl.shared).to.equal(true);
                expect(connectSpy.callCount).to.equal(0);
            });

            it("should dispatch 'command' from a pointWrite on the publisher socket", async function () {
                const { ctl, publisher } = await sharedCtl();

                const commands = [];
                ctl.on("command", (c) => commands.push(c));

                publisher.socket.serverEmit("message", {
                    command: "pointWrite",
                    requestId: "req-shared",
                    data: [{ id: TEST_POINTS[0], writeVal: 7 }],
                });

                expect(commands).to.have.length(1);
                expect(commands[0].requestId).to.equal("req-shared");
            });

            it("should send reportWrite over the publisher socket", async function () {
                const { ctl, publisher } = await sharedCtl();

                ctl.reportWrite("req-shared", [
                    { id: TEST_POINTS[0], writeStatus: "ok" },
                ]);

                expect(publisher.socket.sent.length).to.equal(1);
                const frame = publisher.socket.sent[0].payload;
                expect(uuidValidate(frame.responseId),
                    "responseId is a uuid").to.be.true;
                expect(frame.responseId).to.not.equal(frame.requestId);
                delete frame.responseId;
                expect(frame).to.deep.equal({
                    command: "reportWrite",
                    requestId: "req-shared",
                    data: [{ id: TEST_POINTS[0], writeStatus: "ok" }],
                    done: true,
                });
            });

            it("should detach its handler from the publisher socket on close", async function () {
                const { ctl, publisher } = await sharedCtl();

                const before = publisher.socket.listenerCount("message");
                expect(before).to.equal(1);

                await ctl.close();

                expect(publisher.socket.listenerCount("message")).to.equal(0);
                /* The publisher socket itself is NOT torn down by us. */
                expect(publisher.socket.closed).to.equal(false);
            });

            it("should throw connecting shared with no connected publisher socket", async function () {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.resolve({
                        registrationId: TEST_REG_ID,
                        shared: true,
                        data: [],
                    });
                });

                /* publisher with no live socket. */
                const ctl = ws.createControlListener({ publisher: { socket: null } });
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });

                let err = null;
                try {
                    await ctl.connect();
                } catch (e) {
                    err = e;
                }
                expect(err).to.not.equal(null);
                expect(err.message).to.match(/publisher socket/);
            });
        });

        /* ------------------------------------------------------------
         * Shared-transport re-registration across OVERLAPPING publisher watch
         * swaps (-lpa.3, the _resubShared wedge). A publisher socket-loss storm
         * can swap the watch AGAIN while a shared resub is still in flight. The
         * in-flight resub bound its controlSub to the watch that was live when
         * it started; if it completes against that now-superseded watch the
         * registration is stranded on a dead namespace the publisher no longer
         * holds, with no further event to shake it loose. The session must
         * re-check on completion and resub against the LIVE watch.
         * ---------------------------------------------------------- */
        describe("shared transport re-registration (overlapping swaps)", function () {
            const flush = () => new Promise((resolve) => setImmediate(resolve));

            /* An EventEmitter publisher exposing the surface a shared
             * ControlSession touches: a mutable watchId + socket and the
             * 'reregistered' event a socket-loss recovery fires. */
            function makePublisher(watchId, sock) {
                const pub = new EventEmitter();
                pub.watchId = watchId;
                pub.socket = sock;
                return pub;
            }

            it("resubs against the LIVE watch when a swap lands mid-resub (does not strand on a dead watch)", async function () {
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const WATCH_A = "aaaaaaaa-0000-0000-0000-000000000000";
                const WATCH_B = "bbbbbbbb-0000-0000-0000-000000000000";
                const WATCH_C = "cccccccc-0000-0000-0000-000000000000";

                const socketA = new FakeSocket();
                socketA.connected = true;
                const socketB = new FakeSocket();
                socketB.connected = true;
                const socketC = new FakeSocket();
                socketC.connected = true;

                const subAttachTos = [];
                let controlSubCount = 0;
                let releaseGate;
                const gate = new Promise((resolve) => {
                    releaseGate = resolve;
                });

                ws._wsRawSubmit = sinon.spy((method, uri, body) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/controlSub") {
                        controlSubCount += 1;
                        const attachTo = body && body.attachTo;
                        subAttachTos.push(attachTo);
                        /* For the shared transport the server returns the
                         * registrationId equal to the publisher watchId it
                         * attached the listener to. */
                        const response = {
                            registrationId: attachTo,
                            shared: true,
                            data: [],
                        };
                        /* Gate the FIRST resub controlSub (call #2; the setup
                         * controlSub is #1) so the SECOND swap can land while it
                         * is still in flight. */
                        if (controlSubCount === 2) {
                            return gate.then(() => response);
                        }
                        return Promise.resolve(response);
                    }
                    return Promise.resolve({});
                });

                /* Setup: registered + connected on the shared transport, watch A. */
                const publisher = makePublisher(WATCH_A, socketA);
                const ctl = ws.createControlListener().attachTo(publisher);
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                await ctl.connect();
                expect(ctl.shared).to.equal(true);
                expect(ctl.registrationId).to.equal(WATCH_A);

                /* Swap 1: the publisher recovers onto watch B. Its
                 * 'reregistered' kicks off a shared resub whose controlSub is
                 * gated, so it parks in flight. */
                publisher.watchId = WATCH_B;
                publisher.socket = socketB;
                publisher.emit("reregistered", { registrationId: WATCH_B });
                for (let i = 0; i < 50 && controlSubCount < 2; i++) {
                    await flush();
                }
                expect(controlSubCount).to.equal(2);
                expect(ctl._recovering).to.equal(true);
                expect(subAttachTos).to.eql([WATCH_A, WATCH_B]);

                /* Swap 2 lands WHILE resub#1 is still in flight: the publisher
                 * is now on watch C. Pre-fix this event coalesces into the
                 * in-flight recovery and is lost. */
                publisher.watchId = WATCH_C;
                publisher.socket = socketC;
                publisher.emit("reregistered", { registrationId: WATCH_C });

                /* Let resub#1 complete (it bound watch B) and the stabilisation
                 * re-check run to completion. */
                releaseGate();
                for (let i = 0; i < 200 && ctl._recovering; i++) {
                    await flush();
                }

                /* The registration must end bound to the LIVE watch (C), never
                 * stranded on the superseded watch (B). */
                expect(ctl._recovering).to.equal(false);
                expect(ctl.registrationId).to.equal(WATCH_C);
                expect(ctl.registrationId).to.not.equal(WATCH_B);
                /* It resubbed a second time, against the live watch. */
                expect(subAttachTos).to.eql([WATCH_A, WATCH_B, WATCH_C]);
            });
        });

        /* ------------------------------------------------------------
         * Socket-loss recovery (standalone). A shared registration follows
         * the owning publisher's recovery and does not recover itself.
         * ---------------------------------------------------------- */

        describe("socket-loss recovery (standalone)", function () {
            async function recoverableCtl(opts) {
                opts = opts || {};
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                let subCalls = 0;
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/controlSub") {
                        subCalls += 1;
                        return Promise.resolve({
                            registrationId:
                                subCalls === 1 ? TEST_REG_ID : "fresh-reg-" + subCalls,
                            shared: false,
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

                const ctl = ws.createControlListener(opts.ctlOpts);
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                await ctl.connect(TEST_REG_ID, opts.connectOpts);
                return { ctl, ws, sockets, subCount: () => subCalls };
            }

            const settle = () => new Promise((r) => setImmediate(r));

            it("should re-register fresh on a connect_error", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();
                expect(subCount()).to.equal(1);

                const reregistered = [];
                ctl.on("reregistered", (res) => reregistered.push(res));

                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await settle();
                await settle();

                expect(subCount()).to.equal(2);
                expect(sockets.length).to.equal(2);
                expect(reregistered).to.have.length(1);
                await ctl.close();
            });

            it("should re-register fresh on a disconnect after grace", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();

                const reregistered = [];
                ctl.on("reregistered", (res) => reregistered.push(res));

                sockets[0].serverEmit("disconnect", "transport close");
                await new Promise((r) => setTimeout(r, 1100));
                await settle();

                expect(subCount()).to.equal(2);
                expect(sockets.length).to.equal(2);
                expect(reregistered).to.have.length(1);
                await ctl.close();
            });

            it("should let a within-grace rejoin cancel a pending recovery", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();
                const before = subCount();

                sockets[0].serverEmit("disconnect", "transport close");
                /* socket.io rejoins within grace (re-fires WideSkyConnected). */
                sockets[0].serverEmit("WideSkyConnected", { success: 200 });
                await new Promise((r) => setTimeout(r, 1100));

                expect(subCount()).to.equal(before);
                expect(sockets.length).to.equal(1);
                await ctl.close();
            });

            it("should not recover when autoReregister is disabled", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl({
                    connectOpts: { autoReregister: false },
                });
                const before = subCount();

                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await new Promise((r) => setTimeout(r, 1100));

                expect(subCount()).to.equal(before);
                await ctl.close();
            });

            it("should not recover when autoRecover is disabled", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl({
                    ctlOpts: { autoRecover: false },
                });
                const before = subCount();

                sockets[0].serverEmit("disconnect", "transport close");
                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await new Promise((r) => setTimeout(r, 1100));

                expect(subCount()).to.equal(before);
                await ctl.close();
            });

            it("should not recover after close", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();
                const before = subCount();

                await ctl.close();

                sockets[0].serverEmit("disconnect", "transport close");
                sockets[0].serverEmit("connect_error", "Invalid namespace");
                await new Promise((r) => setTimeout(r, 1100));

                expect(subCount()).to.equal(before);
            });
        });

        /* ------------------------------------------------------------
         * Recovery robustness (CORE-8790, kai-1 / kai-2 review findings). A
         * throwing 'recovering' listener must not wedge the guard flag
         * forever (kai-1, TWO sites: _resubShared + standalone _recover), and
         * a hung recovery REST call must not wedge the retry loop forever
         * either (kai-2, same two sites). Both are permanent-silent-wedge
         * bugs on an unattended device: exactly the failure class this PR
         * exists to prevent.
         * ---------------------------------------------------------- */

        describe("recovery robustness (CORE-8790)", function () {
            const settle = () => new Promise((r) => setImmediate(r));

            function makePublisher(watchId, sock) {
                const pub = new EventEmitter();
                pub.watchId = watchId;
                pub.socket = sock;
                return pub;
            }

            describe("kai-1: throwing 'recovering' listener", function () {
                it("must not wedge _recovering forever (_resubShared, shared transport)", async function () {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    const WATCH_A = "aaaaaaaa-0000-0000-0000-000000000000";
                    const WATCH_B = "bbbbbbbb-0000-0000-0000-000000000000";
                    const WATCH_C = "cccccccc-0000-0000-0000-000000000000";
                    const socketA = new FakeSocket();
                    socketA.connected = true;
                    const socketB = new FakeSocket();
                    socketB.connected = true;
                    const socketC = new FakeSocket();
                    socketC.connected = true;

                    let controlSubCount = 0;
                    ws._wsRawSubmit = sinon.spy((method, uri, body) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/controlSub") {
                            controlSubCount += 1;
                            const attachTo = body && body.attachTo;
                            return Promise.resolve({
                                registrationId: attachTo,
                                shared: true,
                                data: [],
                            });
                        }
                        return Promise.resolve({});
                    });

                    const publisher = makePublisher(WATCH_A, socketA);
                    const ctl = ws.createControlListener().attachTo(publisher);
                    await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                    await ctl.connect();
                    expect(controlSubCount).to.equal(1);

                    const boom = new Error("listener boom");
                    ctl.on("recovering", () => {
                        throw boom;
                    });
                    const reregistered = [];
                    ctl.on("reregistered", (res) => reregistered.push(res));

                    /* Publisher recovers onto watch B: fires 'reregistered',
                     * which drives _resubShared() and now emits 'recovering'
                     * INSIDE the try/finally: the listener above throws
                     * immediately. */
                    publisher.watchId = WATCH_B;
                    publisher.socket = socketB;
                    publisher.emit("reregistered", { registrationId: WATCH_B });

                    for (let i = 0; i < 50 && controlSubCount < 2; i++) {
                        await settle();
                    }

                    /* (a) the guard flag must clear. */
                    expect(ctl._recovering).to.equal(false);
                    /* (b) recovery proceeded despite the throw. */
                    expect(controlSubCount).to.equal(2);
                    expect(ctl.registrationId).to.equal(WATCH_B);
                    expect(reregistered).to.have.length(1);
                    const loggedErrors = log.error.getCalls().map((c) => c.args[0]);
                    expect(loggedErrors).to.include(boom);

                    /* A SUBSEQUENT swap/resub is not permanently wedged. */
                    publisher.watchId = WATCH_C;
                    publisher.socket = socketC;
                    publisher.emit("reregistered", { registrationId: WATCH_C });

                    for (let i = 0; i < 50 && controlSubCount < 3; i++) {
                        await settle();
                    }

                    expect(ctl._recovering).to.equal(false);
                    expect(controlSubCount).to.equal(3);
                    expect(ctl.registrationId).to.equal(WATCH_C);
                });

                it("must not wedge _recovering forever (socket-loss _recover, standalone)", async function () {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    let subCalls = 0;
                    ws._wsRawSubmit = sinon.spy((method, uri) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/controlSub") {
                            subCalls += 1;
                            return Promise.resolve({
                                registrationId:
                                    subCalls === 1 ? TEST_REG_ID : "fresh-reg-" + subCalls,
                                shared: false,
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

                    const ctl = ws.createControlListener();
                    await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                    await ctl.connect(TEST_REG_ID);

                    const boom = new Error("listener boom");
                    ctl.on("recovering", () => {
                        throw boom;
                    });
                    const reregistered = [];
                    ctl.on("reregistered", (res) => reregistered.push(res));

                    sockets[0].serverEmit("connect_error", "Invalid namespace");

                    await settle();
                    await settle();
                    await settle();

                    expect(ctl._recovering).to.equal(false);
                    expect(subCalls).to.equal(2);
                    expect(reregistered).to.have.length(1);
                    const loggedErrors = log.error.getCalls().map((c) => c.args[0]);
                    expect(loggedErrors).to.include(boom);

                    sockets[1].serverEmit("connect_error", "Invalid namespace");
                    await settle();
                    await settle();
                    await settle();

                    expect(ctl._recovering).to.equal(false);
                    expect(subCalls).to.equal(3);
                    expect(reregistered).to.have.length(2);

                    await ctl.close();
                });
            });

            describe("kai-2: recovery REST calls must not hang forever", function () {
                it("times out a hung shared resub controlSub and moves on to the next attempt (_resubShared)", async function () {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    const WATCH_A = "aaaaaaaa-0000-0000-0000-000000000000";
                    const socketA = new FakeSocket();
                    socketA.connected = true;

                    let controlSubCount = 0;
                    const recoveryConfigs = [];
                    ws._wsRawSubmit = sinon.spy((method, uri, body, config) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/controlSub") {
                            controlSubCount += 1;
                            if (controlSubCount === 1) {
                                return Promise.resolve({
                                    registrationId: WATCH_A, shared: true, data: [],
                                });
                            }
                            recoveryConfigs.push(config);
                            if (controlSubCount === 2) {
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
                            return new Promise(() => {});
                        }
                        return Promise.resolve({});
                    });

                    const publisher = new EventEmitter();
                    publisher.watchId = WATCH_A;
                    publisher.socket = socketA;

                    const ctl = ws.createControlListener().attachTo(publisher);
                    await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                    await ctl.connect();
                    expect(controlSubCount).to.equal(1);

                    const clock = sinon.useFakeTimers();
                    try {
                        const reregisterErrors = [];
                        ctl.on("reregisterError", (err) => reregisterErrors.push(err));

                        publisher.emit("reregistered", { registrationId: WATCH_A });

                        await clock.tickAsync(0);
                        expect(controlSubCount).to.equal(2);
                        expect(ctl._recovering).to.equal(true);
                        /* Pin the literal wire value: pre-fix both sides
                         * would be undefined and this would pass vacuously. */
                        expect(recoveryConfigs[0].timeout).to.equal(45000);
                        expect(recoveryConfigs[0].timeout).to.equal(
                            ControlSession.RECOVERY_REQUEST_TIMEOUT_MS);

                        await clock.tickAsync(
                            ControlSession.RECOVERY_REQUEST_TIMEOUT_MS + 1);
                        expect(reregisterErrors).to.have.length(1);
                        expect(reregisterErrors[0].message).to.match(/timeout/);

                        await clock.tickAsync(
                            ControlSession.RECOVER_MAX_BACKOFF_MS + 1);
                        expect(controlSubCount).to.equal(3);
                    }
                    finally {
                        clock.restore();
                    }
                });

                it("times out a hung recovery controlSub and moves on to the next attempt (socket-loss _recover, standalone)", async function () {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    let subCalls = 0;
                    const recoveryConfigs = [];
                    ws._wsRawSubmit = sinon.spy((method, uri, body, config) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/controlSub") {
                            subCalls += 1;
                            if (subCalls === 1) {
                                return Promise.resolve({
                                    registrationId: TEST_REG_ID, shared: false, data: [],
                                });
                            }
                            recoveryConfigs.push(config);
                            if (subCalls === 2) {
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

                    const ctl = ws.createControlListener();
                    await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                    await ctl.connect(TEST_REG_ID);

                    const clock = sinon.useFakeTimers();
                    try {
                        const reregisterErrors = [];
                        ctl.on("reregisterError", (err) => reregisterErrors.push(err));

                        sockets[0].serverEmit("connect_error", "Invalid namespace");

                        await clock.tickAsync(0);
                        expect(subCalls).to.equal(2);
                        expect(ctl._recovering).to.equal(true);
                        /* Pin the literal wire value: pre-fix both sides
                         * would be undefined and this would pass vacuously. */
                        expect(recoveryConfigs[0].timeout).to.equal(45000);
                        expect(recoveryConfigs[0].timeout).to.equal(
                            ControlSession.RECOVERY_REQUEST_TIMEOUT_MS);

                        await clock.tickAsync(
                            ControlSession.RECOVERY_REQUEST_TIMEOUT_MS + 1);
                        expect(reregisterErrors).to.have.length(1);
                        expect(reregisterErrors[0].message).to.match(/timeout/);

                        await clock.tickAsync(
                            ControlSession.RECOVER_MAX_BACKOFF_MS + 1);
                        expect(subCalls).to.equal(3);
                    }
                    finally {
                        clock.restore();
                    }
                });
            });
        });


        /* ------------------------------------------------------------
         * Teardown
         * ---------------------------------------------------------- */

        describe("close (standalone)", function () {
            it("should disconnect and close the socket and drop listeners", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener({ autoRecover: false });
                await ctl.connect(TEST_REG_ID);
                ctl.on("command", () => {});

                await ctl.close();

                expect(fake.disconnected).to.equal(true);
                expect(fake.closed).to.equal(true);
                expect(ctl.socket).to.equal(null);
                expect(ctl.listenerCount("command")).to.equal(0);
            });

            it("should issue controlUnsub when close({ unsub: true })", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                stubStandalone(ws);

                const fake = new FakeSocket();
                sinon.stub(socket, "connect").returns(fake);
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener({ autoRecover: false });
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                await ctl.connect(TEST_REG_ID);

                await ctl.close({ unsub: true });

                const unsubCall = ws._wsRawSubmit
                    .getCalls()
                    .find((c) => c.args[1] === "/api/controlUnsub");
                expect(unsubCall).to.not.equal(undefined);
                expect(unsubCall.args[2]).to.deep.equal({
                    registrationId: TEST_REG_ID,
                });
            });
        });
    });
});
