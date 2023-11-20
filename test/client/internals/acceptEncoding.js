/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client internals
 */
"use strict";

const stubs = require('../../stubs');
const sinon = require('sinon');
const { expect } = require('chai');
const {
    WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN,
    getInstance
} = stubs;

const {
    verifyRequestCall,
} = require("./../utils");

describe('client', () => {
    describe('acceptEncoding', () => {
        let http;
        let log;
        let ws;

        beforeEach(() => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else {
                    return Promise.resolve("default response");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        })

        describe('isAcceptingGzip=true', () => {
            it('should set the Accept-Encoding header', async () => {
                const res = await ws.deleteByFilter('myTag=="my value"');
                expect(res).to.equal("default response");
                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "GET",
                    "/api/deleteRec",
                    {},
                    {
                        headers: {
                            "Accept": "application/json",
                            "Authorization": "Bearer an access token"
                        },
                        params: {
                            filter: 'myTag=="my value"',
                            limit: 0
                        },
                        decompress: true
                    }
                );
            });
        });

        describe('isAcceptingGzip=false', () => {
            it('should not set the Accept-Encoding header', async () => {
                ws.setAcceptGzip(false);

                const res = await ws.deleteByFilter('myTag=="my value"');
                expect(res).to.equal("default response");
                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    "GET",
                    "/api/deleteRec",
                    {},
                    {
                        headers: {
                            "Accept": "application/json",
                            "Authorization": "Bearer an access token"
                        },
                        params: {
                            filter: 'myTag=="my value"',
                            limit: 0
                        }
                    }
                );
            });
        });
    });
});