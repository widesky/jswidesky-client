/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client internals
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;

describe('client', () => {
    describe('login', () => {
        it('should obtain a token then return', () => {
            let http = new stubs.StubHTTPClient(),
                ws = getInstance(http);

            // overwrite spy function
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

            return ws.login().then((res) => {
                expect(res.access_token).to.equal(stubs.WS_ACCESS_TOKEN);
                expect(res.refresh_token).to.equal(stubs.WS_REFRESH_TOKEN);
                expect(res.expires_in).to.above(0);
            });
        });
    });
});