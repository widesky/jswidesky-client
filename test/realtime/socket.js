/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for socket methods
 */
"use strict";

const socket = require("socket.io-client"),
    stubs = require("../stubs"),
    expect = require("chai").expect,
    sinon = require("sinon"),
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const TEST_WATCH_ID = "11111111-aaa1-bbb1-ccc1-222222222222";

/**
 * Build a minimal fake socket.io-client Socket: records registered handlers
 * and exposes the `io.opts.query` that getWatchSocket mutates on reconnect.
 */
function fakeSocket(initialQuery) {
    const handlers = {};
    return {
        handlers,
        io: { opts: { query: initialQuery || {} } },
        on(event, cb) {
            handlers[event] = cb;
            return this;
        },
    };
}

describe("Realtime", function () {
    describe("socket", function () {
        beforeEach(() => {
            sinon.restore();
        });

        it("should generate args without subpath for socket.connect() call", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            sinon.stub(socket, "connect").returns(fakeSocket());

            // Overrwrite the stub ws.getToken() function
            sinon
                .stub(ws, "getToken")
                .returns({ access_token: WS_ACCESS_TOKEN });

            await ws.getWatchSocket(TEST_WATCH_ID);

            expect(ws.baseUri).to.not.equal(undefined);
            expect(ws.getToken.callCount).to.equal(1);
            expect(socket.connect.callCount).to.equal(1);
            expect(socket.connect.getCall(0).args).to.eql([
                `${ws.baseUri}/${TEST_WATCH_ID}`,
                {
                    query: {
                        Authorization: WS_ACCESS_TOKEN
                    },
                    "force new connection": true,
                    autoConnect: false,
                    path: '/socket.io'
                }
            ]);
        });

        it("should generate args with subpath for socket.connect() call", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log, { baseUrl: 'http://localhost:3000/widesky' });

            sinon.stub(socket, "connect").returns(fakeSocket());

            // Overrwrite the stub ws.getToken() function
            sinon
                .stub(ws, "getToken")
                .returns({ access_token: WS_ACCESS_TOKEN });

            await ws.getWatchSocket(TEST_WATCH_ID);

            expect(ws.baseUri).to.not.equal(undefined);
            expect(ws.getToken.callCount).to.equal(1);
            expect(socket.connect.callCount).to.equal(1);
            expect(socket.connect.getCall(0).args).to.eql([
                `http://localhost:3000/${TEST_WATCH_ID}`,
                {
                    query: {
                        Authorization: WS_ACCESS_TOKEN
                    },
                    "force new connection": true,
                    autoConnect: false,
                    path: '/widesky/socket.io'
                }
            ]);
        });

        it("should await a promise-returning getToken() so the socket gets a resolved token", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            sinon.stub(socket, "connect").returns(fakeSocket());

            // getToken() resolves asynchronously when a login/refresh is needed.
            // The socket must still be created with the resolved access token,
            // not `undefined` from a pending promise.
            sinon
                .stub(ws, "getToken")
                .resolves({ access_token: WS_ACCESS_TOKEN });

            await ws.getWatchSocket(TEST_WATCH_ID);

            expect(ws.getToken.callCount).to.equal(1);
            expect(socket.connect.callCount).to.equal(1);
            expect(socket.connect.getCall(0).args[1].query).to.eql({
                Authorization: WS_ACCESS_TOKEN
            });
        });

        it("should refresh the Authorization token on reconnect_attempt", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            const fake = fakeSocket({ Authorization: "tok-1" });
            sinon.stub(socket, "connect").returns(fake);

            const tokenStub = sinon.stub(ws, "getToken");
            tokenStub.onCall(0).resolves({ access_token: "tok-1" });
            tokenStub.onCall(1).resolves({ access_token: "tok-2" });

            await ws.getWatchSocket(TEST_WATCH_ID);
            expect(fake.handlers).to.have.property("reconnect_attempt");

            // Simulate socket.io's reconnect attempt: the handler should pull a
            // fresh token onto io.opts.query for the next handshake.
            await fake.handlers["reconnect_attempt"]();
            expect(fake.io.opts.query.Authorization).to.equal("tok-2");
        });
    });
});
