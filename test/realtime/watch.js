/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for watch methods
 */
"use strict";

const stubs = require("../stubs"),
    expect = require("chai").expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const { verifyTokenCall, verifyRequestCall } = require("../client/utils");

const TEST_POINTS = [
    "00000000-0001-0001-0001-000000000000",
    "00000000-0001-0001-0001-000000000001",
    "00000000-0001-0001-0001-000000000002",
];
const TEST_LEASE = "n:10 sec";
const TEST_WATCH_ID = "11111111-aaa1-bbb1-ccc1-222222222222";

describe("Realtime", function () {
    describe("watch", function () {
        it("should generate correct request grid for watchSub call", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.watchSub(TEST_POINTS, TEST_LEASE, this.test.title, {});
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/watchSub",
                {
                    meta: {
                        ver: "2.0",
                        watchDis: `s:${this.test.title}`,
                        lease: TEST_LEASE,
                    },
                    cols: [{ name: "id" }],
                    rows: [
                        {
                            id: `r:${TEST_POINTS[0]}`,
                        },
                        {
                            id: `r:${TEST_POINTS[1]}`,
                        },
                        {
                            id: `r:${TEST_POINTS[2]}`,
                        },
                    ],
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json",
                    },
                    decompress: true,
                }
            );
        });

        it("should generate correct request grid for watchExtend call", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.watchExtend(TEST_WATCH_ID, TEST_POINTS, TEST_LEASE, {});
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/watchSub",
                {
                    meta: {
                        ver: "2.0",
                        watchId: `s:${TEST_WATCH_ID}`,
                        lease: TEST_LEASE,
                    },
                    cols: [{ name: "id" }],
                    rows: [
                        {
                            id: `r:${TEST_POINTS[0]}`,
                        },
                        {
                            id: `r:${TEST_POINTS[1]}`,
                        },
                        {
                            id: `r:${TEST_POINTS[2]}`,
                        },
                    ],
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json",
                    },
                    decompress: true,
                }
            );
        });

        it("Should generate correct request grid for watchUnsub call", async function () {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.watchUnsub(TEST_WATCH_ID, TEST_POINTS, true);
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/watchUnsub",
                {
                    meta: {
                        ver: "2.0",
                        watchId: `s:${TEST_WATCH_ID}`,
                        close: "m:",
                    },
                    cols: [{ name: "id" }],
                    rows: [
                        {
                            id: `r:${TEST_POINTS[0]}`,
                        },
                        {
                            id: `r:${TEST_POINTS[1]}`,
                        },
                        {
                            id: `r:${TEST_POINTS[2]}`,
                        },
                    ],
                },
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
});
