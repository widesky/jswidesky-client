/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client history methods
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const { verifyTokenCall, verifyRequestCall } = require("./../utils");

describe('client', () => {

    describe('hisDelete', () => {
        const TEST_RANGE = "s:2023-05-13T05:14:30Z, 2023-05-14T05:14:30Z";

        it("should fail if no ids array is empty", async () => {
            const err_msg = "`ids` must contain at least one point UUID.";

            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete([], TEST_RANGE);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range does not provide any timestamp", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const err_msg = "An invalid hisRead range input was given: No range was given.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, "s:");
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range does not start with s:", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const err_msg = "An invalid hisRead range input was given: Missing `s:`.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, "last");
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range contains more than 2 timestamps", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-13T05:14:30Z, 2023-05-13T05:15:30Z, 2023-05-13T05:16:30Z"
            const err_msg = "An invalid hisRead range input was given: Number of timestamps cannot exceed 2.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range is invalid date", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-99"
            const err_msg = "An invalid hisRead range input was given: Invalid ISO8601 timestamp.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range is invalid dateTime", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-13T99:123:55Z";
            const err_msg = "An invalid hisRead range input was given: Invalid ISO8601 timestamp.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range contains at least one invalid dateTime", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-12T05:14:30Z, 2023-05-13T99:123:55Z";
            const err_msg = "An invalid hisRead range input was given: Invalid ISO8601 timestamp.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should generate the correct grid for a single point", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisDelete(TEST_POINT, TEST_RANGE);
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisDelete",
                {
                    meta: {
                        ver: "2.0",
                    },
                    cols: [
                        {
                            name: "range",
                        },
                        {
                            name: "id",
                        },
                    ],
                    rows: [
                        {
                            range: TEST_RANGE,
                            id: `r:${TEST_POINT}`,
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

        it("should generate the correct grid for a single point with a timezone offset", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_OFFSET = "s:2023-05-13T05:14:30+10:00 Brisbane, 2023-05-14T05:14:30+10:00 Brisbane";

            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisDelete(TEST_POINT, TEST_RANGE_OFFSET);
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisDelete",
                {
                    meta: {
                        ver: "2.0",
                    },
                    cols: [
                        {
                            name: "range",
                        },
                        {
                            name: "id",
                        },
                    ],
                    rows: [
                        {
                            range: TEST_RANGE_OFFSET,
                            id: `r:${TEST_POINT}`,
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

        it("should generate the correct grid for an array of points", async () => {
            const TEST_POINTS = [
                "00000112-0000-0000-0000-000000000000",
                "99998000-0000-0000-0000-000000000000",
            ];
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisDelete(TEST_POINTS, TEST_RANGE);
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisDelete",
                {
                    meta: {
                        ver: "2.0",
                    },
                    cols: [
                        {
                            name: "range",
                        },
                        {
                            name: "id0",
                        },
                        {
                            name: "id1",
                        },
                    ],
                    rows: [
                        {
                            range: TEST_RANGE,
                            id0: `r:${TEST_POINTS[0]}`,
                            id1: `r:${TEST_POINTS[1]}`,
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
