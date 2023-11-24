/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;
const {verifyRequestCall} = require("./../utils");

describe('client', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
    });

    /* read-by-filter is handled by the `find` method */
    describe('deleteByFilter', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/deleteRec") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate GET delete if given a filter and no limit', async () => {
            const res = await ws.deleteByFilter('myTag=="my value"');
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/deleteRec",
                {
                    "cols": [
                        {
                            "name": "filter"
                        },
                        {
                            "name": "limit"
                        }
                    ],
                    "meta": {
                        "ver": "2.0"
                    },
                    "rows": [
                        {
                            "filter": "s:myTag==\"my value\"",
                            "limit": "n:0"
                        }
                    ]
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('should include the limit if given', async () => {
            const res = await ws.deleteByFilter('myTag=="my value"', 30);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/deleteRec",
                {
                    "cols": [
                        {
                            "name": "filter"
                        },
                        {
                            "name": "limit"
                        }
                    ],
                    "meta": {
                        "ver": "2.0"
                    },
                    "rows": [
                        {
                            "filter": "s:myTag==\"my value\"",
                            "limit": "n:30"
                        }
                    ]
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it("should reject if filter is not of type string", async () => {
            try {
                await ws.deleteByFilter(123, 30);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Invalid filter type number given. Expected string.")
            }
        });

        it("should reject if limit is negative", async () => {
            try {
                await ws.deleteByFilter("my filter", -1);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Invalid negative limit given.")
            }
        });
    });
});