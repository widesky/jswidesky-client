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
const {Ref} = require("../../../src/data");


describe('client', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
    });

    describe('reloadCache', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/reloadAuthCache") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should call up reload cache API', async () => {
            const res = await ws.reloadCache();
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/reloadAuthCache",
                {},
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