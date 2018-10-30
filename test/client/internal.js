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
    expect = require('chai').expect;

const WS_URI = 'http://localhost:3000',
    WS_USER = 'user@example.com',
    WS_PASSWORD = 'password',
    WS_CLIENT_ID = 'client id string',
    WS_CLIENT_SECRET = 'client secret',
    WS_ACCESS_TOKEN = 'an access token',
    WS_REFRESH_TOKEN = 'a refresh token',
    WS_ACCESS_TOKEN2 = 'another access token',
    WS_REFRESH_TOKEN2 = 'another refresh token';

const getInstance = function(http, log) {
    let c = new WideSkyClient(
        WS_URI, WS_USER, WS_PASSWORD, WS_CLIENT_ID, WS_CLIENT_SECRET, log
    );
    http.stubClient(c);
    return c;
}

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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: WS_REFRESH_TOKEN,
                            expires_in: Date.now() + 10
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: WS_REFRESH_TOKEN,
                            expires_in: Date.now() + 2000
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: WS_REFRESH_TOKEN,
                            expires_in: Date.now() + 10
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                refresh_token: WS_REFRESH_TOKEN,
                                grant_type: 'refresh_token'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN2,
                            refresh_token: WS_REFRESH_TOKEN2,
                            expires_in: Date.now() + 10
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: 'wrong token',
                            expires_in: Date.now() + 10
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                refresh_token: 'wrong token',
                                grant_type: 'refresh_token'
                            }
                        });

                        return Promise.reject(new Error('Refresh failed'));
                    },
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN2,
                            refresh_token: WS_REFRESH_TOKEN2,
                            expires_in: Date.now() + 10
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: WS_REFRESH_TOKEN,
                            expires_in: Date.now() + 10
                        });
                    },
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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: WS_REFRESH_TOKEN,
                            expires_in: Date.now() + 2000
                        });
                    },
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
                            'Access token got deleted'
                        ));
                    },
                    /* We should see this */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN2,
                            refresh_token: WS_REFRESH_TOKEN2,
                            expires_in: Date.now() + 10
                        });
                    },
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

                http.setHandler((options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        method: 'POST',
                        uri: '/oauth2/token',
                        auth: {
                            username: WS_CLIENT_ID,
                            password: WS_CLIENT_SECRET,
                            sendImmediately: true
                        },
                        json: true,
                        body: {
                            username: WS_USER,
                            password: WS_PASSWORD,
                            grant_type: 'password'
                        }
                    });

                    return Promise.reject(new Error('Request failed'));
                });

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
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            method: 'POST',
                            uri: '/oauth2/token',
                            auth: {
                                username: WS_CLIENT_ID,
                                password: WS_CLIENT_SECRET,
                                sendImmediately: true
                            },
                            json: true,
                            body: {
                                username: WS_USER,
                                password: WS_PASSWORD,
                                grant_type: 'password'
                            }
                        });

                        return Promise.resolve({
                            access_token: WS_ACCESS_TOKEN,
                            refresh_token: WS_REFRESH_TOKEN,
                            expires_in: Date.now() + 2000
                        });
                    },
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
    });
});
