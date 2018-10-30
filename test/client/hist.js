/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client history methods
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
    describe('hisRead', () => {
        it('should generate GET hisRead with range as-is '
            + 'if given string', () => {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/hisRead',
                            qs: {
                                'id': '@my.id',
                                'range': '"today"'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws.hisRead('my.id', 'today').then((res) => {
                    expect(res).to.equal('grid goes here');
                });
            });

        it('should generate GET hisRead with range defined by times', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* The read request is next */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/hisRead',
                        qs: {
                            'id': '@my.id',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve('grid goes here');
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisRead(
                'my.id',
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z')
            ).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('if given time range should require `from` to be a Date', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                return ws.hisRead(
                    'my.id',
                    false,
                    new Date('2018-01-01T00:00Z')
                ).then(() => {
                    throw new Error('This should not have worked');
                });
            } catch (err) {
                if (err.message !== '`from` is not a Date')
                    throw err;
            }
        });

        it('if given time range should require `to` to be a Date', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                return ws.hisRead(
                    'my.id',
                    new Date('2018-01-01T00:00Z'),
                    false
                ).then(() => {
                    throw new Error('This should not have worked');
                });
            } catch (err) {
                if (err.message !== '`to` is not a Date')
                    throw err;
            }
        });

        it('should support reading more than one point', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* The read request is next */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/hisRead',
                        qs: {
                            'id0': '@my.pt.a',
                            'id1': '@my.pt.b',
                            'id2': '@my.pt.c',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve('grid goes here');
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisRead(
                ['my.pt.a', 'my.pt.b', 'my.pt.c'],
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z')
            ).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    describe('hisWrite', () => {
        it('should generate POST with records in timestamp order', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* The read request is next */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'POST',
                        uri: '/api/hisWrite',
                        body: {
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
                        }
                    });

                    return Promise.resolve('grid goes here');
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisWrite(
                {
                    't:2016-01-02T00:00Z UTC': {
                        'r:my.id': 'n:123.45'
                    },
                    't:2016-01-01T00:00Z UTC': {
                        'r:my.id': 'n:234.56'
                    },
                    't:2016-02-01T00:00Z UTC': {
                        'r:my.id': 'n:631.42'
                    }
                }
            ).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should support multiple points', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* The read request is next */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'POST',
                        uri: '/api/hisWrite',
                        body: {
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
                        }
                    });

                    return Promise.resolve('grid goes here');
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisWrite(
                {
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
                }
            ).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });
});
