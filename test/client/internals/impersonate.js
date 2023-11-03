/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client internals
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_USER = stubs.WS_USER,
    WS_PASSWORD = stubs.WS_PASSWORD,
    WS_CLIENT_ID = stubs.WS_CLIENT_ID,
    WS_CLIENT_SECRET = stubs.WS_CLIENT_SECRET,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    WS_ACCESS_TOKEN2 = stubs.WS_ACCESS_TOKEN2,
    WS_REFRESH_TOKEN2 = stubs.WS_REFRESH_TOKEN2,
    getInstance = stubs.getInstance;

const {
    verifyTokenCall,
    verifyRequestCall,
    sleep
} = require("./../utils");
const { HaystackError, GraphQLError } = require("../../../src/errors");

describe('client', () => {
    describe('impersonate', () => {
        let http;
        let log;
        let ws;
        let targetUser = 'a_user_id';

        beforeEach(async () => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
            ws.impersonateAs(targetUser);
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

        describe('impersonateAs', () => {
            it('should set the X-IMPERSONATE header', async () => {
                ws.impersonateAs(targetUser);

                const res = await ws.deleteByFilter('myTag=="my value"', 30);
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
                            "Authorization": "Bearer an access token",
                            "X-IMPERSONATE": targetUser
                        },
                        params: {
                            filter: 'myTag=="my value"',
                            limit: 30
                        },
                        decompress: true
                    }
                );
            });
        });

        describe('unsetImpersonate', () => {
            it('should omit the X-IMPERSONATE attribute in header', async () => {
                ws.unsetImpersonate();

                const res = await ws.deleteByFilter('myTag=="my value"', 30);
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
                            limit: 30
                        },
                        decompress: true
                    }
                );
            });
        });

        describe('isImpersonating', () => {
            describe('and impersonateAs() was called', () => {
                it('should return true', () => {
                    expect(ws.isImpersonating()).to.equal(true);
                });
            });

            describe('and unsetImpersonate was called', () => {
                beforeEach(() => {
                    ws.unsetImpersonate();
                });

                it('should return false', () => {
                    expect(ws.isImpersonating()).to.equal(false);
                });
            });
        });
    });
});
