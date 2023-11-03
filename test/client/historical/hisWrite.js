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

    describe('hisWrite', () => {
        it('should generate POST with records in timestamp order', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                let returnItem;
                if (uri === "/oauth2/token") {
                    returnItem = {
                        access_token: WS_ACCESS_TOKEN
                    };
                } else if (uri === "/api/hisWrite") {
                    returnItem = "grid goes here";
                } else {
                    returnItem = {};
                }

                return Promise.resolve(returnItem);
            });

            const result = await ws.hisWrite({
                't:2016-01-02T00:00Z UTC': {
                    'r:my.id': 'n:123.45'
                },
                't:2016-01-01T00:00Z UTC': {
                    'r:my.id': 'n:234.56'
                },
                't:2016-02-01T00:00Z UTC': {
                    'r:my.id': 'n:631.42'
                }
            });
            expect(result).to.equal("grid goes here");
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisWrite",
                {
                    meta: {ver: "2.0"},
                    cols: [
                        {name: "ts"},
                        {name: "v0", id: "r:my.id"}
                    ],
                    rows: [
                        {
                            ts: "t:2016-01-01T00:00Z UTC",
                            v0: "n:234.56"
                        },
                        {
                            ts: "t:2016-01-02T00:00Z UTC",
                            v0: "n:123.45"
                        },
                        {
                            ts: "t:2016-02-01T00:00Z UTC",
                            v0: "n:631.42"
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

        it('should support multiple points', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                let returnItem;
                if (uri === "/oauth2/token") {
                    returnItem = {
                        access_token: WS_ACCESS_TOKEN
                    };
                } else if (uri === "/api/hisWrite") {
                    returnItem = "grid goes here";
                } else {
                    returnItem = {};
                }

                return Promise.resolve(returnItem);
            });

            const result = await ws.hisWrite({
                't:2016-01-02T00:00Z UTC': {
                    'r:my.pt.a': 'n:347347',
                    'r:my.pt.b': 'n:123456',
                    'r:my.pt.c': 'n:175332'
                },
                't:2016-01-01T00:00Z UTC': {
                    'r:my.pt.a': 'n:223466',
                    'r:my.pt.b': 'n:176485'
                },
                't:2016-02-01T00:00Z UTC': {
                    'r:my.pt.a': 'n:623672',
                    'r:my.pt.c': 'n:623457'
                },
                't:2016-02-02T00:00Z UTC': {
                    'r:my.pt.b': 'n:612342',
                    'r:my.pt.c': 'n:873442'
                }
            });
            expect(result).to.equal("grid goes here");
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisWrite",
                {
                    meta: {ver: "2.0"},
                    cols: [
                        {name: "ts"},
                        {name: "v0", id: "r:my.pt.a"},
                        {name: "v1", id: "r:my.pt.b"},
                        {name: "v2", id: "r:my.pt.c"}
                    ],
                    rows: [
                        {
                            ts: "t:2016-01-01T00:00Z UTC",
                            v0: "n:223466",
                            v1: "n:176485"
                        },
                        {
                            ts: "t:2016-01-02T00:00Z UTC",
                            v0: "n:347347",
                            v1: "n:123456",
                            v2: "n:175332"
                        },
                        {
                            ts: "t:2016-02-01T00:00Z UTC",
                            v0: "n:623672",
                            v2: "n:623457"
                        },
                        {
                            ts: "t:2016-02-02T00:00Z UTC",
                            v1: "n:612342",
                            v2: "n:873442"
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
    });
});