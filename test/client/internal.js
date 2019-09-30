/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client internals
 * (C) 2018 VRT Systems
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


describe('client', () => {
    describe('internals', () => {
        describe('_ws_raw_submit', () => {
            let options = {
                arg1: 'This is a requests options object',
                arg2: 'We expect a copy of this to be made',
                arg3: 'and baseUrl added to that copy.',
                arg4: 'This should remain untouched.'
            };

            it('should clone options and insert base_uri from '
                + 'constructor arguments', () => {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    http.setHandler((options) => {
                        expect(options.baseUrl).to.equal(
                            WS_URI
                        );

                        /* Return a dummy payload */
                        return Promise.resolve(null);
                    });

                    return ws._ws_raw_submit(options).then((body) => {
                        expect(body).to.be.null;
                        expect(options.baseUrl).to.be.undefined;

                        expect(log.trace.calledOnce).to.be.true;
                        expect(log.trace.firstCall.args).to.eql([
                            Object.assign({
                                baseUrl: WS_URI
                            }, options),
                            'Raw request'
                        ]);
                    });
            });
        });

        describe('_ws_hs_submit', () => {
            it('should obtain a token before sending request', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* Then our actual request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws._ws_hs_submit({
                    arg: 'Arbitrary settings go here.'
                }).then((res) => {
                    expect(res).to.equal('my response');
                });
            });

            it('should use token until expiry', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler({expires_in: 2000}),
                    /* Then our actual requests */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response');
                    },
                    /* Now our final request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response 2');
                    },
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws._ws_hs_submit({
                    arg: 'Arbitrary settings go here.'
                }).then((res) => {
                    expect(res).to.equal('my response');

                    return new Promise((resolve) => {
                        /* Time passes */
                        setTimeout(resolve, 20);
                    });
                }).then(() => {
                    return ws._ws_hs_submit({
                        arg: 'Arbitrary settings go here.'
                    });
                }).then((res) => {
                    expect(res).to.equal('my response 2');
                });
            });

            it('should refresh a token on expiry', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* Then our actual request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response');
                    },
                    /* We should see this after expiry */
                    stubs.authHandler({
                        refresh: true,
                        send_access_token: WS_ACCESS_TOKEN2,
                        send_refresh_token: WS_REFRESH_TOKEN2,
                    }),
                    /* Now our final request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN2,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response 2');
                    },
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws._ws_hs_submit({
                    arg: 'Arbitrary settings go here.'
                }).then((res) => {
                    expect(res).to.equal('my response');

                    return new Promise((resolve) => {
                        /* Time passes */
                        setTimeout(resolve, 20);
                    });
                }).then(() => {
                    return ws._ws_hs_submit({
                        arg: 'Arbitrary settings go here.'
                    });
                }).then((res) => {
                    expect(res).to.equal('my response 2');
                });
            });

            it('should retry log-in if refresh token fails', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler({send_refresh_token: 'wrong token'}),
                    /* Then our actual request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response');
                    },
                    /* We should see this after expiry */
                    stubs.authHandler({
                        refresh: true,
                        expect_refresh_token: 'wrong token',
                        err: {
                            message: 'Refresh failed'
                        }
                    }),
                    /* The client should try logging in proper */
                    stubs.authHandler({
                        send_access_token: WS_ACCESS_TOKEN2,
                        send_refresh_token: WS_REFRESH_TOKEN2
                    }),
                    /* Now our final request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN2,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Arbitrary settings go here.'
                        });

                        return Promise.resolve('my response 2');
                    },
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws._ws_hs_submit({
                    arg: 'Arbitrary settings go here.'
                }).then((res) => {
                    expect(res).to.equal('my response');

                    return new Promise((resolve) => {
                        /* Time passes */
                        setTimeout(resolve, 20);
                    });
                }).then(() => {
                    return ws._ws_hs_submit({
                        arg: 'Arbitrary settings go here.'
                    });
                }).then((res) => {
                    expect(res).to.equal('my response 2');
                });
            });

            it('should not request more than one token at a time', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* Then our actual requests */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Request 1.'
                        });

                        return Promise.resolve('my response');
                    },
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Request 2.'
                        });

                        return Promise.resolve('my response 2');
                    },
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                let first = ws._ws_hs_submit({
                    arg: 'Request 1.'
                }), second = ws._ws_hs_submit({
                    arg: 'Request 2.'
                });

                return first.then((res) => {
                    expect(res).to.equal('my response');
                    return second;
                }).then((res) => {
                    expect(res).to.equal('my response 2');
                });
            });

            it('should handle invalid tokens', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler({
                        expires_in: 2000
                    }),
                    /* Then our actual request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Request 1.'
                        });

                        return Promise.resolve('my response');
                    },
                    /* We should see this again */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Request 2.'
                        });

                        return Promise.reject(new stubs.StubHTTPStatusCodeError(
                            'Access token got deleted', 401
                        ));
                    },
                    /* We should see this */
                    stubs.authHandler({
                        send_access_token: WS_ACCESS_TOKEN2
                    }),
                    /* Now our final request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN2,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Request 2.'
                        });

                        return Promise.resolve('my response 2');
                    },
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws._ws_hs_submit({
                    arg: 'Request 1.'
                }).then((res) => {
                    expect(res).to.equal('my response');

                    return new Promise((resolve) => {
                        /* Time passes */
                        setTimeout(resolve, 20);
                    });
                }).then(() => {
                    return ws._ws_hs_submit({
                        arg: 'Request 2.'
                    });
                }).then((res) => {
                    expect(res).to.equal('my response 2');
                });
            });

            it('should pass on unexpected failures on login', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                http.setHandler(stubs.authHandler({
                    err: {
                        message: 'Request failed'
                    }
                }));

                let first = ws._ws_hs_submit({
                    arg: 'Request 1.'
                }), second = ws._ws_hs_submit({
                    arg: 'Request 2.'
                });

                let check = (p) => {
                    return p.then(() => {
                        throw new Error('This worked, how?');
                    }).catch((err) => {
                        if (err.message !== 'Request failed')
                            throw err;
                    });
                };

                return Promise.all([check(first), check(second)]);
            });

            it('should pass on unexpected failures in session', () => {
                let http = new stubs.StubHTTPClient(),
                    ws = getInstance(http);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler({expires_in: 2000}),
                    /* Then our actual request */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            arg: 'Request 1.'
                        });

                        return Promise.reject(new Error('Request failed'));
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws._ws_hs_submit({
                    arg: 'Request 1.'
                }).then(() => {
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
                    expect(res).to.be.undefined;
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
