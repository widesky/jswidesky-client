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

    /* True while this socket is still "live": opened, not torn down. */
    isLive() {
        return this.opened && !this.disconnected && !this.closed;
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
         * Socket-loss recovery (standalone). Setup runs on the real clock;
         * a fake clock then drives the disconnect-grace window and recovery
         * backoff deterministically (no wall-clock waits). The shared-transport
         * recovery (a registration that rides an owning publisher's socket) is
         * exercised separately below: it follows the publisher's socket swap.
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

            it("should re-register fresh on a connect_error", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();
                expect(subCount()).to.equal(1);

                const clock = sinon.useFakeTimers();
                try {
                    const reregistered = [];
                    ctl.on("reregistered", (res) => reregistered.push(res));

                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    expect(subCount()).to.equal(2);
                    expect(sockets.length).to.equal(2);
                    expect(reregistered).to.have.length(1);
                } finally {
                    clock.restore();
                }
                await ctl.close();
            });

            it("should re-register fresh on a connection_error after grace (authz vs transient split)", async function () {
                /* tg-4: a connection_error must NOT storm a fresh controlSub on a
                 * loop. The publisher splits connect_error (dead namespace ->
                 * recover) from connection_error (a non-owner/authz reject); the
                 * control listener must mirror that split, so a connection_error
                 * goes through the dead-namespace re-register path exactly ONCE,
                 * not the connect_error retry loop that would re-issue controlSub
                 * forever against a reject that never clears. */
                const http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                /* The initial controlSub succeeds; every RE-register controlSub
                 * fails (a non-owner / authz reject that will never clear). Under
                 * the buggy connect_error retry loop this would re-issue
                 * controlSub on each backoff (1s,2s,4s,8s,16s -> many calls). The
                 * one-shot dead-namespace path tries exactly once and stops. */
                let subCalls = 0;
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/controlSub") {
                        subCalls += 1;
                        if (subCalls === 1) {
                            return Promise.resolve({
                                registrationId: TEST_REG_ID,
                                shared: false,
                                data: [],
                            });
                        }
                        return Promise.reject(new Error("Forbidden"));
                    }
                    return Promise.resolve();
                });

                const sockets = [];
                sinon.stub(socket, "connect").callsFake(() => {
                    const sk = new FakeSocket();
                    sockets.push(sk);
                    return sk;
                });
                sinon.stub(ws, "getToken")
                    .returns({ access_token: WS_ACCESS_TOKEN });

                const ctl = ws.createControlListener();
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                await ctl.connect(TEST_REG_ID);
                expect(subCalls).to.equal(1);

                const clock = sinon.useFakeTimers();
                try {
                    const errors = [];
                    ctl.on("reregisterError", (e) => errors.push(e));

                    sockets[0].serverEmit("connection_error", "Forbidden");
                    /* Advance well past several backoff cycles a storming loop
                     * would use (1s+2s+4s+8s+16s). */
                    await clock.tickAsync(1 + 1000 + 2000 + 4000 + 8000 + 16000);

                    /* Exactly ONE re-register controlSub was attempted (the
                     * initial + a single failed re-register = 2 total), and a
                     * single reregisterError fired. It did NOT storm a loop. */
                    expect(subCalls).to.equal(2);
                    expect(errors).to.have.length(1);
                } finally {
                    clock.restore();
                }
                await ctl.close();
            });

            it("should re-register fresh on a disconnect after grace", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();

                const clock = sinon.useFakeTimers();
                try {
                    const reregistered = [];
                    ctl.on("reregistered", (res) => reregistered.push(res));

                    sockets[0].serverEmit("disconnect", "transport close");
                    await clock.tickAsync(1100);

                    expect(subCount()).to.equal(2);
                    expect(sockets.length).to.equal(2);
                    expect(reregistered).to.have.length(1);
                } finally {
                    clock.restore();
                }
                await ctl.close();
            });

            it("should let a within-grace rejoin cancel a pending recovery", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();
                const before = subCount();

                const clock = sinon.useFakeTimers();
                try {
                    sockets[0].serverEmit("disconnect", "transport close");
                    /* socket.io rejoins within grace (re-fires WideSkyConnected). */
                    sockets[0].serverEmit("WideSkyConnected", { success: 200 });
                    await clock.tickAsync(1100);

                    expect(subCount()).to.equal(before);
                    expect(sockets.length).to.equal(1);
                } finally {
                    clock.restore();
                }
                await ctl.close();
            });

            it("should not recover when autoReregister is disabled", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl({
                    connectOpts: { autoReregister: false },
                });
                const before = subCount();

                const clock = sinon.useFakeTimers();
                try {
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1100);

                    expect(subCount()).to.equal(before);
                } finally {
                    clock.restore();
                }
                await ctl.close();
            });

            it("should not recover when autoRecover is disabled", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl({
                    ctlOpts: { autoRecover: false },
                });
                const before = subCount();

                const clock = sinon.useFakeTimers();
                try {
                    sockets[0].serverEmit("disconnect", "transport close");
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1100);

                    expect(subCount()).to.equal(before);
                } finally {
                    clock.restore();
                }
                await ctl.close();
            });

            it("should not recover after close", async function () {
                const { ctl, sockets, subCount } = await recoverableCtl();
                const before = subCount();

                await ctl.close();

                const clock = sinon.useFakeTimers();
                try {
                    sockets[0].serverEmit("disconnect", "transport close");
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1100);

                    expect(subCount()).to.equal(before);
                } finally {
                    clock.restore();
                }
            });
        });

        /* ------------------------------------------------------------
         * Shared-transport recovery: a shared ControlSession rides the owning
         * publisher's socket, so when the publisher swaps its socket on recovery
         * the control handler must be rebound to the NEW socket. This is the
         * tg-2 / re-2 / kai-1 defect: previously the handler was bound once to
         * the original socket and went deaf after the publisher recovered.
         * ---------------------------------------------------------- */

        describe("shared transport recovery", function () {
            /* A publisher-compatible fake socket: its open() resolves the
             * publisher handshake by firing 'connect' (not WideSkyConnected). */
            class PubFakeSocket extends FakeSocket {
                open() {
                    this.opened = true;
                    setImmediate(() => {
                        this.connected = true;
                        EventEmitter.prototype.emit.call(this, "connect");
                    });
                }
            }

            /*
             * Build a real PublisherSession + a shared ControlSession riding it.
             * Setup runs on the real clock; the caller installs a fake clock to
             * drive the publisher's recovery. socket.connect hands out a
             * PubFakeSocket per call so a publisher recovery opens a NEW socket.
             */
            async function sharedOverPublisher() {
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
                                    ? "pub-watch-1"
                                    : "pub-watch-" + watchPubCalls,
                            data: [],
                        });
                    }
                    if (uri === "/api/controlSub") {
                        /* Shared registration: rides the publisher's namespace. */
                        return Promise.resolve({
                            registrationId: "pub-watch-1",
                            shared: true,
                            data: [],
                        });
                    }
                    return Promise.resolve();
                });

                const sockets = [];
                sinon.stub(socket, "connect").callsFake(() => {
                    const s = new PubFakeSocket();
                    sockets.push(s);
                    return s;
                });
                sinon.stub(ws, "getToken").returns({ access_token: WS_ACCESS_TOKEN });

                const pub = ws.createPublisher();
                await pub.watchPub({
                    data: [{ id: TEST_POINTS[0], intervalFast: 1000 }],
                });
                await pub.connect("pub-watch-1");

                const ctl = ws.createControlListener().attachTo(pub);
                await ctl.controlSub({ data: [{ id: TEST_POINTS[0] }] });
                await ctl.connect();

                return { pub, ctl, ws, sockets };
            }

            it("should dispatch a command on the publisher socket before any recovery", async function () {
                const { pub, ctl, sockets } = await sharedOverPublisher();
                expect(ctl.shared).to.equal(true);
                expect(sockets.length).to.equal(1);

                const commands = [];
                ctl.on("command", (c) => commands.push(c));

                pub.socket.serverEmit("message", {
                    command: "pointWrite",
                    requestId: "req-pre",
                    data: [{ id: TEST_POINTS[0], writeVal: 1 }],
                });

                expect(commands).to.have.length(1);
                expect(commands[0].requestId).to.equal("req-pre");
                await ctl.close();
                await pub.close();
            });

            it("should rebind the command handler to the publisher's NEW socket after recovery", async function () {
                const { pub, ctl, sockets } = await sharedOverPublisher();

                const clock = sinon.useFakeTimers();
                try {
                    const commands = [];
                    ctl.on("command", (c) => commands.push(c));

                    /* Drive the publisher through a connect_error recovery so it
                     * tears down sockets[0] and opens a brand-new socket. */
                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    /* The publisher swapped to a new socket. */
                    expect(sockets.length).to.equal(2);
                    expect(pub.socket).to.equal(sockets[1]);

                    /* The OLD socket is dead; a pointWrite on it must NOT surface
                     * (it was the source of the silent-deafness defect). */
                    sockets[0].serverEmit("message", {
                        command: "pointWrite",
                        requestId: "req-dead",
                        data: [{ id: TEST_POINTS[0], writeVal: 2 }],
                    });

                    /* A pointWrite on the NEW publisher socket MUST surface as a
                     * command: the shared control handler was rebound on swap. */
                    sockets[1].serverEmit("message", {
                        command: "pointWrite",
                        requestId: "req-new",
                        data: [{ id: TEST_POINTS[0], writeVal: 3 }],
                    });

                    const ids = commands.map((c) => c.requestId);
                    expect(ids).to.include("req-new");
                    expect(ids).to.not.include("req-dead");
                } finally {
                    clock.restore();
                }
                await ctl.close();
                await pub.close();
            });

            it("should not leave a stale handler on the old socket after recovery", async function () {
                const { pub, ctl, sockets } = await sharedOverPublisher();

                const clock = sinon.useFakeTimers();
                try {
                    const commands = [];
                    ctl.on("command", (c) => commands.push(c));

                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    /* The old socket had ALL listeners removed by the publisher's
                     * teardown (no stale control handler clinging to a dead
                     * socket). */
                    expect(sockets[0].listenerCount("message")).to.equal(0);

                    /* And it no longer surfaces commands: a pointWrite replayed on
                     * the dead socket is silently inert. */
                    sockets[0].serverEmit("message", {
                        command: "pointWrite",
                        requestId: "req-stale",
                        data: [{ id: TEST_POINTS[0], writeVal: 9 }],
                    });
                    expect(commands.map((c) => c.requestId))
                        .to.not.include("req-stale");
                } finally {
                    clock.restore();
                }
                await ctl.close();
                await pub.close();
            });

            it("should drop the rebound handler on close (no leak on the publisher socket)", async function () {
                const { pub, ctl, sockets } = await sharedOverPublisher();

                const clock = sinon.useFakeTimers();
                try {
                    const commands = [];
                    ctl.on("command", (c) => commands.push(c));

                    sockets[0].serverEmit("connect_error", "Invalid namespace");
                    await clock.tickAsync(1);

                    /* The rebound handler is live on the new socket before close
                     * (a pointWrite surfaces). */
                    sockets[1].serverEmit("message", {
                        command: "pointWrite",
                        requestId: "req-live",
                        data: [{ id: TEST_POINTS[0], writeVal: 1 }],
                    });
                    expect(commands.map((c) => c.requestId)).to.include("req-live");

                    await ctl.close();

                    /* After close the shared handler is gone: a later pointWrite on
                     * the live publisher socket no longer surfaces, and we did not
                     * tear that socket down (the publisher owns it). */
                    sockets[1].serverEmit("message", {
                        command: "pointWrite",
                        requestId: "req-after-close",
                        data: [{ id: TEST_POINTS[0], writeVal: 2 }],
                    });
                    expect(commands.map((c) => c.requestId))
                        .to.not.include("req-after-close");
                    expect(pub.socket.closed).to.equal(false);
                } finally {
                    clock.restore();
                }
                await pub.close();
            });
        });
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
