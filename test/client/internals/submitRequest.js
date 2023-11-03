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
    describe('internals', () => {
        describe('submitRequest', () => {
            it('should obtain a token before sending request', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                // overwrite spy function
                ws.getToken = sinon.stub().returns(WS_ACCESS_TOKEN);
                ws._wsRawSubmit = sinon.stub().returns("my response");

                const result = await ws.submitRequest("GET", "URI");
                expect(result).to.equal("my response");
                expect(ws.getToken.callCount).to.equal(1);
                expect(ws.getToken.calledBefore(ws._wsRawSubmit)).to.be.true;
            });

            it('should use token until expiry', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                // overwrite spy function
                ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            expires_in: Date.now() + 2000
                        });
                    } else {
                        return Promise.resolve("default response");
                    }
                });

                const res = await ws.submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(100);
                const res2 = await ws.submitRequest("GET", "URI");
                expect(res2).to.equal("default response");

                expect(ws._wsRawSubmit.callCount).to.equal(3);
                verifyTokenCall(ws._wsRawSubmit.getCall(0).args);

                const expectedArgs = [
                    {},
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": `Bearer ${WS_ACCESS_TOKEN}`
                            }
                        }
                    },
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": `Bearer ${WS_ACCESS_TOKEN}`
                            }
                        }
                    }
                ];

                for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                    const {method, uri, body, config} = expectedArgs[i];
                    verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
                }
            });

            it('should refresh a token on expiry', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                // overwrite spy function
                ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                    if (uri === "/oauth2/token") {
                        if (body.grant_type === "refresh_token") {
                            return Promise.resolve({
                                access_token: WS_REFRESH_TOKEN2,
                                refresh_token: WS_ACCESS_TOKEN2,
                                expires_in: Date.now() + 2000
                            });
                        } else {
                            return Promise.resolve({
                                access_token: WS_ACCESS_TOKEN,
                                refresh_token: WS_REFRESH_TOKEN,
                                expires_in: Date.now() + 20
                            });
                        }
                    } else {
                        return Promise.resolve("default response");
                    }
                });

                const res = await ws.submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(100);
                const res2 = await ws.submitRequest("GET", "URI");
                expect(res2).to.equal("default response");

                expect(ws._wsRawSubmit.callCount).to.equal(4);
                verifyTokenCall(ws._wsRawSubmit.getCall(0).args);
                const expectedArgs = [
                    {},
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": "Bearer an access token"
                            }
                        }
                    },
                    {
                        method: "POST",
                        uri: "/oauth2/token",
                        body: {
                            refresh_token: WS_REFRESH_TOKEN,
                            grant_type: 'refresh_token'
                        },
                        config: {
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET
                            }
                        }
                    },
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": `Bearer ${WS_REFRESH_TOKEN}`
                            }
                        }
                    }
                ];

                for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                    const {method, uri, body, config} = expectedArgs[i];
                    verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
                }
            });

            it('should retry log-in if refresh token fails', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                // overwrite stubs
                ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                    if (uri === "/oauth2/token") {
                        if (body.grant_type === "refresh_token") {
                            return Promise.reject({
                                refresh: true,
                                expect_refresh_token: 'wrong token',
                                err: {
                                    message: 'Refresh failed'
                                }
                            });
                        } else {
                            return Promise.resolve({
                                access_token: WS_ACCESS_TOKEN,
                                refresh_token: WS_REFRESH_TOKEN,
                                expires_in: Date.now() + 20
                            });
                        }
                    } else {
                        return Promise.resolve("default response");
                    }
                });

                const res = await ws.submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(200);
                const res2 = await ws.submitRequest("GET", "URI");
                expect(res2).to.equal("default response");

                expect(ws._wsRawSubmit.callCount).to.equal(5);
                verifyTokenCall(ws._wsRawSubmit.getCall(0).args);
                const expectedArgs = [
                    {},
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": "Bearer an access token"
                            }
                        }
                    },
                    {
                        method: "POST",
                        uri: "/oauth2/token",
                        body: {
                            refresh_token: WS_REFRESH_TOKEN,
                            grant_type: 'refresh_token'
                        },
                        config: {
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET
                            }
                        }
                    },
                    {
                        method: "POST",
                        uri: "/oauth2/token",
                        body: {
                            username: WS_USER,
                            password: WS_PASSWORD,
                            grant_type: "password"
                        },
                        config: {
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET
                            }
                        }
                    },
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": `Bearer ${WS_REFRESH_TOKEN}`
                            }
                        }
                    }
                ];

                for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                    const {method, uri, body, config} = expectedArgs[i];
                    verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
                }
            });

            it('should not request more than one token at a time', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                    if (uri === "/oauth2/token") {
                        if (body.grant_type === "refresh_token") {
                            return Promise.resolve({
                                access_token: WS_REFRESH_TOKEN2,
                                refresh_token: WS_ACCESS_TOKEN2,
                                expires_in: Date.now() + 2000
                            });
                        } else {
                            return Promise.resolve({
                                access_token: WS_ACCESS_TOKEN,
                                refresh_token: WS_REFRESH_TOKEN,
                                expires_in: Date.now() + 20
                            });
                        }
                    } else {
                        return Promise.resolve("default response");
                    }
                });

                let first = ws.submitRequest("GET", "URI");
                let second = ws.submitRequest("GET", "URI");

                return first.then((res) => {
                    expect(res).to.equal("default response");
                    return second;
                }).then((res2) => {
                    expect(res2).to.equal("default response");

                    // check calls made
                    expect(ws._wsRawSubmit.callCount).to.equal(3);
                    verifyTokenCall(ws._wsRawSubmit.firstCall.args);
                    const expectedArgs = [
                        {},      // skip first as its verified as token call above
                        {
                            method: "GET",
                            uri: "URI",
                            body: {},
                            config: {
                                "decompress": true,
                                "headers": {
                                    "Accept": "application/json",
                                    "Authorization": "Bearer an access token"
                                }
                            }
                        },
                        {
                            method: "GET",
                            uri: "URI",
                            body: {},
                            config: {
                                "decompress": true,
                                "headers": {
                                    "Accept": "application/json",
                                    "Authorization": "Bearer an access token"
                                }
                            }
                        }
                    ];

                    for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                        const {method, uri, body, config} = expectedArgs[i];
                        verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
                    }
                });
            });

            it('should handle invalid tokens', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                    if (uri === "/oauth2/token") {
                        if (body.grant_type === "refresh_token") {
                            return Promise.reject(new stubs.StubHTTPStatusCodeError(
                                'Access token got deleted', 401
                            ));
                        } else {
                            return Promise.resolve({
                                access_token: WS_ACCESS_TOKEN,
                                refresh_token: WS_REFRESH_TOKEN,
                                expires_in: Date.now() + 20
                            });
                        }
                    } else {
                        return Promise.resolve("default response");
                    }
                });

                const res = await ws.submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(200);
                const res2 = await ws.submitRequest("GET", "URI");
                expect(res2).to.equal("default response");

                expect(ws._wsRawSubmit.callCount).to.equal(5);
                verifyTokenCall(ws._wsRawSubmit.getCall(0).args);
                const expectedArgs = [
                    {},
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": "Bearer an access token"
                            }
                        }
                    },
                    {
                        method: "POST",
                        uri: "/oauth2/token",
                        body: {
                            refresh_token: WS_REFRESH_TOKEN,
                            grant_type: 'refresh_token'
                        },
                        config: {
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET
                            }
                        }
                    },
                    {
                        method: "POST",
                        uri: "/oauth2/token",
                        body: {
                            username: WS_USER,
                            password: WS_PASSWORD,
                            grant_type: "password"
                        },
                        config: {
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET
                            }
                        }
                    },
                    {
                        method: "GET",
                        uri: "URI",
                        body: {},
                        config: {
                            "decompress": true,
                            "headers": {
                                "Accept": "application/json",
                                "Authorization": `Bearer ${WS_REFRESH_TOKEN}`
                            }
                        }
                    }
                ];

                for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                    const {method, uri, body, config} = expectedArgs[i];
                    verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
                }
            });

            it('should pass on unexpected failures on login', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                ws.getToken = sinon.stub().callsFake((method, uri, body, config) => {
                    return Promise.reject({
                        message: "Request failed"
                    });
                });

                function check(promise) {
                    return promise.then(() => {
                        throw new Error('This worked, how?');
                    }).catch((err) => {
                        if (err.message !== 'Request failed')
                            throw err;
                    });
                }

                return Promise.all([
                    check(ws.submitRequest("GET", "URI")),
                    check(ws.submitRequest("GET", "URI"))
                ]);
            });

            it('should pass on unexpected failures in session', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                ws.getToken = sinon.stub().callsFake((method, uri, body, config) => {
                    return Promise.reject(new Error("Request failed"));
                });

                return ws.submitRequest("GET", "URI"
                ).then(() => {
                    throw new Error('This worked, how?');
                }).catch((err) => {
                    if (err.message !== 'Request failed')
                        throw err;
                });
            });

            it('should retry log-in if request fails due to 401', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                ws._attachReqConfig = sinon.stub().callsFake((config) => {
                    if (ws._ws_token !== null) {
                        ws._ws_token = WS_ACCESS_TOKEN;
                        return ws._ws_token;

                    } else {
                        ws._ws_token = WS_ACCESS_TOKEN2;
                        return ws._ws_token;
                    }
                });
                ws._ws_token = "not null";

                ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                    if (config === WS_ACCESS_TOKEN) {
                        return Promise.reject({
                            isAxiosError: true,
                            response: {
                                status: 401
                            }
                        });
                    } else if (config === WS_ACCESS_TOKEN2) {
                        return Promise.resolve("success");
                    } else {
                        return Promise.reject({response: {status: "unexpected error"}});
                    }
                });

                await ws.submitRequest("GET", "URI", null, null);

                expect(ws._wsRawSubmit.callCount).to.equal(2);
                expect(ws._attachReqConfig.callCount).to.equal(2);
                expect(ws._ws_token).to.equal(WS_ACCESS_TOKEN2);
            });

            describe("error handling", () => {
                let http, ws;
                before(() => {
                    http = new stubs.StubHTTPClient();
                    ws = getInstance(http);
                    ws._attachReqConfig = sinon.stub().callsFake((config) => {
                        if (ws._ws_token !== null) {
                            ws._ws_token = WS_ACCESS_TOKEN;
                            return ws._ws_token;

                        } else {
                            ws._ws_token = WS_ACCESS_TOKEN2;
                            return ws._ws_token;
                        }
                    });
                    ws._ws_token = "not null";
                });

                it("should throw syntax error if encountered", async () => {
                    let caughtErr;
                    ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                        try {
                            const a = [][0][1];
                        } catch (error) {
                            caughtErr = error;
                            throw error;
                        }
                    });

                    try {
                        await ws.submitRequest("GET", "URI", null, null);
                        throw new Error("Did not work");
                    } catch (error) {
                        expect(error.message).to.equal(caughtErr.message);
                    }
                });

                it("should throw Axios error if no response received", async () => {
                    ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                        const error = new Error("Pretend Axios Error");
                        error.isAxiosError = true;
                        throw error;
                    });

                    try {
                        await ws.submitRequest("GET", "URI", null, null);
                        throw new Error("Did not work");
                    } catch (error) {
                        expect(error.message).to.equal("Pretend Axios Error");
                    }
                });

                it("should throw response as Haystack error if suitable", async () => {
                    let err;
                    ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                        err = new Error("Pretend Axios Error");
                        err.isAxiosError = true;
                        err.response = {
                            data: {
                                meta: {
                                    dis: "s:A WideSky API server error"
                                }
                            }
                        };
                        throw err;
                    });

                    try {
                        await ws.submitRequest("GET", "URI", null, null);
                        throw new Error("Did not work");
                    } catch (error) {
                        expect(error).to.be.instanceof(HaystackError);
                        expect(error.message).to.equal("A WideSky API server error");
                    }
                });

                it("should throw response as GraphQL error if suitable", async () => {
                    let err;
                    ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                        err = new Error("Pretend Axios Error");
                        err.isAxiosError = true;
                        err.response = {
                            data: {
                                errors: [
                                    {
                                        "message": "Field \"search\" argument \"whereTag\" of type \"String!\" is " +
                                            "required but not provided.",
                                        "locations": [
                                            {
                                                "line": 5,
                                                "column": 5
                                            }
                                        ]
                                    }
                                ]
                            }
                        };
                        throw err;
                    });

                    try {
                        await ws.submitRequest("GET", "URI", null, null);
                        throw new Error("Did not work");
                    } catch (error) {
                        expect(error).to.be.instanceof(GraphQLError);
                        expect(error.message).to.equal(
                            "Field \"search\" argument \"whereTag\" of type \"String!\" is " +
                            "required but not provided."
                        );
                    }
                });
            });
        });
    });
});