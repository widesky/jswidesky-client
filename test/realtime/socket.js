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

describe("Realtime", function () {
    describe("socket", function () {
        it("should generate correct args for socket.connect() call", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Stub the socket.connect() function
            sinon.stub(socket, "connect").returns("mockSocket");
            
            // Overrwrite the stub ws.getToken() function
            sinon
                .stub(ws, "getToken")
                .returns({ access_token: WS_ACCESS_TOKEN });

            await ws.getWatchSocket(TEST_WATCH_ID);

            expect(ws.getToken.callCount).to.equal(1);
            expect(socket.connect.callCount).to.equal(1);
            expect(socket.connect.firstCall.args).to.eql(
                [
                    `${ws.base_uri}/${TEST_WATCH_ID}`,
                    {
                        query: {
                            Authorization: WS_ACCESS_TOKEN
                        },
                        "force new connection": true,
                        autoConnect: false
                    }
                ]
            )
        });
    });
});
