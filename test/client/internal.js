/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client internals
 */
"use strict";

const WideSkyClient = require('../../src/client'),
    stubs = require('../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_URI = stubs.WS_URI,
    WS_USER = stubs.WS_USER,
    WS_PASSWORD = stubs.WS_PASSWORD,
    WS_CLIENT_ID = stubs.WS_CLIENT_ID,
    WS_CLIENT_SECRET = stubs.WS_CLIENT_SECRET,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    WS_ACCESS_TOKEN2 = stubs.WS_ACCESS_TOKEN2,
    WS_REFRESH_TOKEN2 = stubs.WS_REFRESH_TOKEN2,
    getInstance = stubs.getInstance;

const { verifyTokenCall, verifyRequestCall } = require("./utils");


function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(() => {
            return resolve()
        }, ms);
    })
}

describe('client', () => {
    describe('internals', () => {
        describe('_submitRequest', () => {
            it('should obtain a token before sending request', async () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                // overwrite spy function
                ws.getToken = sinon.stub().returns(WS_ACCESS_TOKEN);
                ws._wsRawSubmit = sinon.stub().returns("my response");

                const result = await ws._submitRequest("GET", "URI");
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

                const res = await ws._submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(100);
                const res2 = await ws._submitRequest("GET", "URI");
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
                    const { method, uri, body, config } = expectedArgs[i];
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

                const res = await ws._submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(100);
                const res2 = await ws._submitRequest("GET", "URI");
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
                    const { method, uri, body, config } = expectedArgs[i];
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

                const res = await ws._submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(200);
                const res2 = await ws._submitRequest("GET", "URI");
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
                    const { method, uri, body, config } = expectedArgs[i];
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

                let first = ws._submitRequest("GET", "URI");
                let second = ws._submitRequest("GET", "URI");

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
                        const { method, uri, body, config } = expectedArgs[i];
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

                const res = await ws._submitRequest("GET", "URI");
                expect(res).to.equal("default response");
                await sleep(200);
                const res2 = await ws._submitRequest("GET", "URI");
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
                    const { method, uri, body, config } = expectedArgs[i];
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
                    check(ws._submitRequest("GET", "URI")),
                    check(ws._submitRequest("GET", "URI"))
                ]);
            });

            it('should pass on unexpected failures in session', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                ws.getToken = sinon.stub().callsFake((method, uri, body, config) => {
                    return Promise.reject(new Error("Request failed"));
                });

                return ws._submitRequest("GET", "URI"
                ).then(() => {
                    throw new Error('This worked, how?');
                }).catch((err) => {
                    if (err.message !== 'Request failed')
                        throw err;
                });
            });
        });

        describe('login', () => {
            it('should obtain a token then return', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We should only see a log-in attempt */
                http.setHandler(stubs.authHandler());

                return ws.login().then((res) => {
                    expect(res.access_token).to.equal(stubs.WS_ACCESS_TOKEN);
                    expect(res.refresh_token).to.equal(stubs.WS_REFRESH_TOKEN);
                    expect(res.expires_in).to.above(0);
                });
            });
        });

        describe('acceptEncoding', () => {
            let http;
            let log;
            let ws;

            beforeEach(() => {
                http = new stubs.StubHTTPClient();
                log = new stubs.StubLogger();
                ws = getInstance(http, log);
            });

            describe('isAcceptingGzip=true', () => {
                it('should set the Accept-Encoding header', () => {
                    let requestHandlers = [
                        /* First up, an authentication request */
                        stubs.authHandler(),
                        (options) => {
                            return Promise.resolve(options);
                        }
                    ];

                    http.setHandler((options) => {
                        return requestHandlers.shift()(options);
                    });

                    return ws.deleteByFilter('myTag=="my value"', 0).then((options) => {
                        expect(options.gzip).to.equal(true);
                    });
                });
            });

            describe('isAcceptingGzip=false', () => {
                it('should not set the Accept-Encoding header', () => {
                    ws.setAcceptGzip(false);

                    let requestHandlers = [
                        /* First up, an authentication request */
                        stubs.authHandler(),
                        (options) => {
                            return Promise.resolve(options);
                        }
                    ];

                    http.setHandler((options) => {
                        return requestHandlers.shift()(options);
                    });

                    return ws.deleteByFilter('myTag=="my value"', 0).then((options) => {
                        expect(options).to.not.have.property('gzip');
                    });
                });
            });
        });

        describe('impersonate', () => {
            let http;
            let log;
            let ws;
            let targetUser = 'a_user_id';

            beforeEach(() => {
                http = new stubs.StubHTTPClient();
                log = new stubs.StubLogger();
                ws = getInstance(http, log);

                ws.impersonateAs(targetUser);
            });

            describe('impersonateAs', () => {
                it('should set the X-IMPERSONATE header', () => {
                    ws.impersonateAs(targetUser);

                    let requestHandlers = [
                        /* First up, an authentication request */
                        stubs.authHandler(),
                        (options) => {
                            return Promise.resolve(options);
                        }
                    ];

                    http.setHandler((options) => {
                        return requestHandlers.shift()(options);
                    });

                    return ws.deleteByFilter('myTag=="my value"', 30).then((options) => {
                        expect(options.headers).to.have.property('X-IMPERSONATE');
                        expect(options.headers['X-IMPERSONATE']).to.equal(targetUser);
                    });
                });
            });

            describe('unsetImpersonate', () => {
                it('should omit the X-IMPERSONATE attribute in header', () => {
                    ws.unsetImpersonate();

                    let requestHandlers = [
                        /* First up, an authentication request */
                        stubs.authHandler(),
                        (options) => {
                            return Promise.resolve(options);
                        }
                    ];

                    http.setHandler((options) => {
                        return requestHandlers.shift()(options);
                    });

                    return ws.deleteByFilter('myTag=="my value"', 30).then((options) => {
                        expect(options.headers).to.not.have.property('X-IMPERSONATE');
                    });
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
});
