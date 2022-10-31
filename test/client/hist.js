/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client history methods
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

function verifyTokenCall(args) {
    expect(args[0]).to.equal("POST");
    expect(args[1]).to.equal("/oauth2/token");
    expect(args[2]).to.deep.equal({
        username: WS_USER,
        password: WS_PASSWORD,
        grant_type: "password"
    });
    expect(args[3]).to.deep.equal({
        auth: {
            username: WS_CLIENT_ID,
            password: WS_CLIENT_SECRET
        }
    });
}

describe('client', () => {
    describe('hisRead', () => {
        it('should generate GET hisRead with range as-is if given string', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisRead("my.id", "today");
            expect(ws._ws_raw_submit.callCount).to.equal(2);
            verifyTokenCall(ws._ws_raw_submit.firstCall.args);
            const hisWriteArgs = ws._ws_raw_submit.secondCall.args;
            expect(hisWriteArgs[0]).to.equal("GET");
            expect(hisWriteArgs[1]).to.equal("/api/hisRead");
            expect(hisWriteArgs[2]).to.deep.equal({})       // empty body
            expect(hisWriteArgs[3]).to.deep.equal({
                params: {
                    range: "\"today\"",
                    id: "@my.id"
                },
                headers: {
                    Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                    Accept: "application/json"
                },
                decompress: true
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
                        gzip: true,
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
                        gzip: true,
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

        it('should perform big reads in batches', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* Read request 1 */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        gzip: true,
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

                    return Promise.resolve({
                        meta: {
                            ver: '2.0'
                        },
                        cols: [
                            {name: 'ts'},
                            {
                                name: 'v0',
                                id: 'r:my.pt.a',
                            },
                            {
                                name: 'v1',
                                id: 'r:my.pt.b'
                            },
                            {
                                name: 'v2',
                                id: 'r:my.pt.c'
                            }
                        ],
                        rows: []
                    });
                },
                /* Read request 2 */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        gzip: true,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/hisRead',
                        qs: {
                            'id0': '@my.pt.d',
                            'id1': '@my.pt.e',
                            'id2': '@my.pt.f',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve({
                        meta: {
                            ver: '2.0'
                        },
                        cols: [
                            {name: 'ts'},
                            {
                                name: 'v0',
                                id: 'r:my.pt.d',
                            },
                            {
                                name: 'v1',
                                id: 'r:my.pt.e'
                            },
                            {
                                name: 'v2',
                                id: 'r:my.pt.f'
                            }
                        ],
                        rows: []
                    });
                },
                /* Read request 3 */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        gzip: true,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/hisRead',
                        qs: {
                            'id0': '@my.pt.g',
                            'id1': '@my.pt.h',
                            'id2': '@my.pt.i',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve({
                        meta: {
                            ver: '2.0'
                        },
                        cols: [
                            {name: 'ts'},
                            {
                                name: 'v0',
                                id: 'r:my.pt.g',
                            },
                            {
                                name: 'v1',
                                id: 'r:my.pt.h'
                            },
                            {
                                name: 'v2',
                                id: 'r:my.pt.i'
                            }
                        ],
                        rows: []
                    });
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisRead(
                [
                    'my.pt.a', 'my.pt.b', 'my.pt.c',
                    'my.pt.d', 'my.pt.e', 'my.pt.f',
                    'my.pt.g', 'my.pt.h', 'my.pt.i',
                ],
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z'),
                3
            ).then((res) => {
                expect(res).to.eql({
                    meta: {
                        ver: '2.0',
                        hisStart: null,
                        hisEnd: null
                    },
                    cols: [
                        {name: 'ts'},
                        {
                            name: 'v0',
                            id: 'r:my.pt.a',
                        },
                        {
                            name: 'v1',
                            id: 'r:my.pt.b'
                        },
                        {
                            name: 'v2',
                            id: 'r:my.pt.c'
                        },
                        {
                            name: 'v3',
                            id: 'r:my.pt.d',
                        },
                        {
                            name: 'v4',
                            id: 'r:my.pt.e'
                        },
                        {
                            name: 'v5',
                            id: 'r:my.pt.f'
                        },
                        {
                            name: 'v6',
                            id: 'r:my.pt.g',
                        },
                        {
                            name: 'v7',
                            id: 'r:my.pt.h'
                        },
                        {
                            name: 'v8',
                            id: 'r:my.pt.i'
                        }
                    ],
                    rows: []
                });
            });
        });

        it('should merge the batch read grids\' results', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* Read request 1 */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        gzip: true,
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

                    return Promise.resolve({
                        meta: {
                            ver: '2.0'
                        },
                        cols: [
                            {name: 'ts'},
                            {
                                name: 'v0',
                                id: 'r:my.pt.a',
                            },
                            {
                                name: 'v1',
                                id: 'r:my.pt.b'
                            },
                            {
                                name: 'v2',
                                id: 'r:my.pt.c'
                            }
                        ],
                        rows: [
                            {
                                ts: 't:2015-01-01T00:00:00Z UTC',
                                v0: 'n:110',
                                v1: 'n:120',
                                v2: 'n:130'
                            },
                            {
                                ts: 't:2015-01-01T01:00:00Z UTC',
                                v0: 'n:111',
                                v1: 'n:121',
                                v2: 'n:131'
                            },
                            {
                                ts: 't:2015-01-01T02:00:00Z UTC',
                                v0: 'n:112',
                                v1: 'n:122',
                                v2: 'n:132'
                            }
                        ]
                    });
                },
                /* Read request 2 */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        gzip: true,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/hisRead',
                        qs: {
                            'id0': '@my.pt.d',
                            'id1': '@my.pt.e',
                            'id2': '@my.pt.f',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve({
                        meta: {
                            ver: '2.0'
                        },
                        cols: [
                            {name: 'ts'},
                            {
                                name: 'v0',
                                id: 'r:my.pt.d',
                            },
                            {
                                name: 'v1',
                                id: 'r:my.pt.e'
                            },
                            {
                                name: 'v2',
                                id: 'r:my.pt.f'
                            }
                        ],
                        rows: [
                            {
                                ts: 't:2015-01-01T00:00:00Z UTC',
                                v0: 'n:210',
                                v1: 'n:220',
                                v2: 'n:230'
                            },
                            {
                                ts: 't:2015-01-01T01:00:00Z UTC',
                                v0: 'n:211',
                                v1: 'n:221',
                                v2: 'n:231'
                            },
                            {
                                ts: 't:2015-01-01T02:00:00Z UTC',
                                v0: 'n:212',
                                v1: 'n:222',
                                v2: 'n:232'
                            }
                        ]
                    });
                },
                /* Read request 3 */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        gzip: true,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/hisRead',
                        qs: {
                            'id0': '@my.pt.g',
                            'id1': '@my.pt.h',
                            'id2': '@my.pt.i',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve({
                        meta: {
                            ver: '2.0'
                        },
                        cols: [
                            {name: 'ts'},
                            {
                                name: 'v0',
                                id: 'r:my.pt.g',
                            },
                            {
                                name: 'v1',
                                id: 'r:my.pt.h'
                            },
                            {
                                name: 'v2',
                                id: 'r:my.pt.i'
                            }
                        ],
                        rows: [
                            {
                                ts: 't:2015-01-01T00:00:00Z UTC',
                                v0: 'n:310',
                                v1: 'n:320',
                                v2: 'n:330',
                            },
                            {
                                ts: 't:2015-01-01T01:00:00Z UTC',
                                v0: 'n:311',
                                v1: 'n:321',
                                v2: 'n:331',
                            },
                            {
                                ts: 't:2015-01-01T02:00:00Z UTC',
                                v0: 'n:312',
                                v1: 'n:322',
                                v2: 'n:332',
                            }
                        ]
                    });
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisRead(
                [
                    'my.pt.a', 'my.pt.b', 'my.pt.c',
                    'my.pt.d', 'my.pt.e', 'my.pt.f',
                    'my.pt.g', 'my.pt.h', 'my.pt.i',
                ],
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z'),
                3
            ).then((res) => {
                expect(res).to.eql({
                    meta: {
                        ver: '2.0',
                        hisStart: null,
                        hisEnd: null
                    },
                    cols: [
                        {name: 'ts'},
                        {
                            name: 'v0',
                            id: 'r:my.pt.a',
                        },
                        {
                            name: 'v1',
                            id: 'r:my.pt.b'
                        },
                        {
                            name: 'v2',
                            id: 'r:my.pt.c'
                        },
                        {
                            name: 'v3',
                            id: 'r:my.pt.d',
                        },
                        {
                            name: 'v4',
                            id: 'r:my.pt.e'
                        },
                        {
                            name: 'v5',
                            id: 'r:my.pt.f'
                        },
                        {
                            name: 'v6',
                            id: 'r:my.pt.g',
                        },
                        {
                            name: 'v7',
                            id: 'r:my.pt.h'
                        },
                        {
                            name: 'v8',
                            id: 'r:my.pt.i'
                        }
                    ],
                    rows: [
                        {
                            ts: 't:2015-01-01T00:00:00Z UTC',
                            v0: 'n:110',
                            v1: 'n:120',
                            v2: 'n:130',
                            v3: 'n:210',
                            v4: 'n:220',
                            v5: 'n:230',
                            v6: 'n:310',
                            v7: 'n:320',
                            v8: 'n:330'
                        },
                        {
                            ts: 't:2015-01-01T01:00:00Z UTC',
                            v0: 'n:111',
                            v1: 'n:121',
                            v2: 'n:131',
                            v3: 'n:211',
                            v4: 'n:221',
                            v5: 'n:231',
                            v6: 'n:311',
                            v7: 'n:321',
                            v8: 'n:331'
                        },
                        {
                            ts: 't:2015-01-01T02:00:00Z UTC',
                            v0: 'n:112',
                            v1: 'n:122',
                            v2: 'n:132',
                            v3: 'n:212',
                            v4: 'n:222',
                            v5: 'n:232',
                            v6: 'n:312',
                            v7: 'n:322',
                            v8: 'n:332'
                        }
                    ]
                });
            });
        });

        describe('._mergeHisReadRes', () => {
            let http, log, ws;

            const TS = [
                new Date('2021-06-01T00:00:00+10:00'),
                new Date('2021-06-04T13:04:53+10:00'),
                new Date('2021-06-30T23:59:59+10:00')
            ];

            const TS_ISO = TS.map((ts) => {
                return ts.toISOString();
            });
            const TS_VAL = TS.map((ts) => {
                return ts.valueOf();
            });

            beforeEach(() => {
                http = new stubs.StubHTTPClient();
                log = new stubs.StubLogger();
                ws = getInstance(http, log);
            });

            describe('meta data merging', () => {
                describe('hisStart', () => {
                    it('should ignore missing field in block result', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: 't:' + TS_ISO[0],
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: TS_VAL[0],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {ver: '2.0'},
                                cols: [],
                                rows: []
                            }
                        );

                        /* Nothing should change */

                        expect(status).to.eql({
                            his_start: TS_VAL[0],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        });

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: 't:' + TS_ISO[0],
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        });
                    });

                    it('should ignore later field in block result', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: 't:' + TS_ISO[0],
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: TS_VAL[0],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0',
                                    hisStart: 't:' + TS_ISO[1]
                                },
                                cols: [],
                                rows: []
                            }
                        );

                        /* Nothing should change */

                        expect(status).to.eql({
                            his_start: TS_VAL[0],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        });

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: 't:' + TS_ISO[0],
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        });
                    });

                    it('should use block result field if earlier', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: 't:' + TS_ISO[2],
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: TS_VAL[2],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0',
                                    hisStart: 't:' + TS_ISO[1]
                                },
                                cols: [],
                                rows: []
                            }
                        );

                        /* Should have changed to the value given */

                        expect(status).to.eql({
                            his_start: TS_VAL[1],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        });

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: 't:' + TS_ISO[1],
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        });
                    });
                });

                describe('hisEnd', () => {
                    it('should ignore missing field in block result', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: 't:' + TS_ISO[0]
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: null,
                            his_end: TS_VAL[0],
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {ver: '2.0'},
                                cols: [],
                                rows: []
                            }
                        );

                        /* Nothing should change */

                        expect(status).to.eql({
                            his_start: null,
                            his_end: TS_VAL[0],
                            col_id: {},
                            row_ts: {}
                        });

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: 't:' + TS_ISO[0]
                            },
                            cols: [],
                            rows: []
                        });
                    });

                    it('should ignore earlier field in block result', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: 't:' + TS_ISO[2]
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: null,
                            his_end: TS_VAL[2],
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0',
                                    hisStart: null,
                                    hisEnd: 't:' + TS_ISO[1]
                                },
                                cols: [],
                                rows: []
                            }
                        );

                        /* Nothing should change */

                        expect(status).to.eql({
                            his_start: null,
                            his_end: TS_VAL[2],
                            col_id: {},
                            row_ts: {}
                        });

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: 't:' + TS_ISO[2]
                            },
                            cols: [],
                            rows: []
                        });
                    });

                    it('should use block result field if later', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: 't:' + TS_ISO[0]
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: null,
                            his_end: TS_VAL[0],
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0',
                                    hisStart: null,
                                    hisEnd: 't:' + TS_ISO[1]
                                },
                                cols: [],
                                rows: []
                            }
                        );

                        /* Should have changed to the value given */

                        expect(status).to.eql({
                            his_start: null,
                            his_end: TS_VAL[1],
                            col_id: {},
                            row_ts: {}
                        });

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: 't:' + TS_ISO[1]
                            },
                            cols: [],
                            rows: []
                        });
                    });
                });

                describe('other fields', () => {
                    it('should copy across fields unchanged', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: null
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: TS_VAL[0],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0',
                                    field1: 's:a value'
                                },
                                cols: [],
                                rows: []
                            }
                        );

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: null,
                                field1: 's:a value'
                            },
                            cols: [],
                            rows: []
                        });
                    });

                    it('should not overwrite existing fields', () => {
                        let result = {
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: null,
                                field1: 's:existing value'
                            },
                            cols: [],
                            rows: []
                        };

                        let status = {
                            his_start: TS_VAL[0],
                            his_end: null,
                            col_id: {},
                            row_ts: {}
                        };

                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'id1', 'id2', 'id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0',
                                    field1: 's:new value'
                                },
                                cols: [],
                                rows: []
                            }
                        );

                        expect(result).to.eql({
                            meta: {
                                ver: '2.0',
                                hisStart: null,
                                hisEnd: null,
                                field1: 's:existing value'
                            },
                            cols: [],
                            rows: []
                        });
                    });
                });
            });

            describe('row merging', () => {
                it('should reject row with missing ts', () => {
                    let result = {
                        meta: {
                            ver: '2.0',
                            hisStart: null,
                            hisEnd: null
                        },
                        cols: [],
                        rows: []
                    };

                    let status = {
                        his_start: TS_VAL[0],
                        his_end: null,
                        col_id: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        row_ts: {}
                    };

                    try {
                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'r:id1', 'r:id2', 'r:id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0'
                                },
                                cols: [],
                                rows: [
                                    {
                                        /* No TS */
                                        v0: 'n:123',
                                        v1: 'n:456',
                                        v2: 'n:789'
                                    },
                                    {
                                        ts: 't:' + TS_ISO[1],
                                        v0: 'n:012',
                                        v1: 'n:345',
                                        v2: 'n:678'
                                    },
                                    {
                                        ts: 't:' + TS_ISO[2],
                                        v0: 'n:901',
                                        v1: 'n:234',
                                        v2: 'n:567'
                                    }
                                ]
                            }
                        );
                        throw new Error('Should not have worked');
                    } catch (err) {
                        if (
                            err.message !==
                            'Expected date/time for ts column, got: undefined'
                        ) {
                            throw err;
                        }
                    }
                });

                it('should reject row with malformed ts', () => {
                    let result = {
                        meta: {
                            ver: '2.0',
                            hisStart: null,
                            hisEnd: null
                        },
                        cols: [],
                        rows: []
                    };

                    let status = {
                        his_start: TS_VAL[0],
                        his_end: null,
                        col_id: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        row_ts: {}
                    };

                    try {
                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'r:id1', 'r:id2', 'r:id3'
                            ], 
                            {
                                meta: {
                                    ver: '2.0'
                                },
                                cols: [],
                                rows: [
                                    {
                                        ts: 's:' + TS_ISO[0], /* A String! */
                                        v0: 'n:123',
                                        v1: 'n:456',
                                        v2: 'n:789'
                                    },
                                    {
                                        ts: 't:' + TS_ISO[1],
                                        v0: 'n:012',
                                        v1: 'n:345',
                                        v2: 'n:678'
                                    },
                                    {
                                        ts: 't:' + TS_ISO[2],
                                        v0: 'n:901',
                                        v1: 'n:234',
                                        v2: 'n:567'
                                    }
                                ]
                            }
                        );
                        throw new Error('Should not have worked');
                    } catch (err) {
                        if (
                            err.message !== (
                                'Expected date/time for ts column, got: s:'
                                + TS_ISO[0]
                            )
                        ) {
                            throw err;
                        }
                    }
                });

                it('should reject row with unexpected ID', () => {
                    /*
                     * This should never happen, but let's ensure throw an
                     * appropriate error if it does happen.
                     */

                    let result = {
                        meta: {
                            ver: '2.0',
                            hisStart: null,
                            hisEnd: null
                        },
                        cols: [],
                        rows: []
                    };

                    let status = {
                        his_start: TS_VAL[0],
                        his_end: null,
                        col_id: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        row_ts: {}
                    };

                    try {
                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'r:id0', 'r:id2', 'r:id3' /* id0 not in col_id */
                            ], 
                            {
                                meta: {
                                    ver: '2.0'
                                },
                                cols: [],
                                rows: [
                                    {
                                        ts: 't:' + TS_ISO[0],
                                        v0: 'n:123',
                                        v1: 'n:456',
                                        v2: 'n:789'
                                    },
                                    {
                                        ts: 't:' + TS_ISO[1],
                                        v0: 'n:012',
                                        v1: 'n:345',
                                        v2: 'n:678'
                                    },
                                    {
                                        ts: 't:' + TS_ISO[2],
                                        v0: 'n:901',
                                        v1: 'n:234',
                                        v2: 'n:567'
                                    }
                                ]
                            }
                        );
                        throw new Error('Should not have worked');
                    } catch (err) {
                        if (err.message !== 'Unexpected ID r:id0') {
                            throw err;
                        }
                    }
                });

                it('should add rows to status.row_ts', () => {
                    let result = {
                        meta: {
                            ver: '2.0',
                            hisStart: null,
                            hisEnd: null
                        },
                        cols: [],
                        rows: []
                    };

                    let status = {
                        his_start: TS_VAL[0],
                        his_end: null,
                        col_id: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        row_ts: {}
                    };

                    ws._mergeHisReadRes(
                        result, status,
                        [
                            'r:id1', 'r:id2', 'r:id3'
                        ], 
                        {
                            meta: {
                                ver: '2.0'
                            },
                            cols: [],
                            rows: [
                                {
                                    ts: 't:' + TS_ISO[0],
                                    v0: 'n:123',
                                    v1: 'n:456',
                                    v2: 'n:789'
                                },
                                {
                                    ts: 't:' + TS_ISO[1],
                                    v0: 'n:012',
                                    v1: 'n:345',
                                    v2: 'n:678'
                                },
                                {
                                    ts: 't:' + TS_ISO[2],
                                    v0: 'n:901',
                                    v1: 'n:234',
                                    v2: 'n:567'
                                }
                            ]
                        }
                    );

                    expect(status.row_ts).to.eql({
                        [TS_VAL[0]]: {
                            ts: 't:' + TS_ISO[0],
                            v3: 'n:123',
                            v4: 'n:456',
                            v5: 'n:789'
                        },
                        [TS_VAL[1]]: {
                            ts: 't:' + TS_ISO[1],
                            v3: 'n:012',
                            v4: 'n:345',
                            v5: 'n:678'
                        },
                        [TS_VAL[2]]: {
                            ts: 't:' + TS_ISO[2],
                            v3: 'n:901',
                            v4: 'n:234',
                            v5: 'n:567'
                        }
                    });
                });

                it('should skip adding nulls/missing columns', () => {
                    let result = {
                        meta: {
                            ver: '2.0',
                            hisStart: null,
                            hisEnd: null
                        },
                        cols: [],
                        rows: []
                    };

                    let status = {
                        his_start: TS_VAL[0],
                        his_end: null,
                        col_id: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        row_ts: {}
                    };

                    ws._mergeHisReadRes(
                        result, status,
                        [
                            'r:id1', 'r:id2', 'r:id3'
                        ], 
                        {
                            meta: {
                                ver: '2.0'
                            },
                            cols: [],
                            rows: [
                                {
                                    ts: 't:' + TS_ISO[0],
                                    /* v0 missing */
                                    v1: 'n:456',
                                    v2: 'n:789'
                                },
                                {
                                    ts: 't:' + TS_ISO[1],
                                    v0: 'n:012',
                                    v1: null,
                                    v2: 'n:678'
                                },
                                {
                                    ts: 't:' + TS_ISO[2],
                                    v0: 'n:901',
                                    v1: 'n:234',
                                    v2: 'n:567'
                                }
                            ]
                        }
                    );

                    expect(status.row_ts).to.eql({
                        [TS_VAL[0]]: {
                            ts: 't:' + TS_ISO[0],
                            v4: 'n:456',
                            v5: 'n:789'
                        },
                        [TS_VAL[1]]: {
                            ts: 't:' + TS_ISO[1],
                            v3: 'n:012',
                            v5: 'n:678'
                        },
                        [TS_VAL[2]]: {
                            ts: 't:' + TS_ISO[2],
                            v3: 'n:901',
                            v4: 'n:234',
                            v5: 'n:567'
                        }
                    });
                });

                it('should add fields to existing rows in.row_ts', () => {
                    let result = {
                        meta: {
                            ver: '2.0',
                            hisStart: null,
                            hisEnd: null
                        },
                        cols: [],
                        rows: []
                    };

                    let status = {
                        his_start: TS_VAL[0],
                        his_end: null,
                        col_id: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        row_ts: {
                            [TS_VAL[0]]: {
                                ts: 't:' + TS_ISO[0],
                                v0: 'n:111',
                                v1: 'n:222',
                                v2: 'n:333'
                            },
                            [TS_VAL[1]]: {
                                ts: 't:' + TS_ISO[1],
                                v0: 'n:444',
                                v1: 'n:555',
                                v2: 'n:666'
                            },
                            [TS_VAL[2]]: {
                                ts: 't:' + TS_ISO[2],
                                v0: 'n:777',
                                v1: 'n:888',
                                v2: 'n:999'
                            }
                        }
                    };

                    ws._mergeHisReadRes(
                        result, status,
                        [
                            'r:id1', 'r:id2', 'r:id3'
                        ], 
                        {
                            meta: {
                                ver: '2.0'
                            },
                            cols: [],
                            rows: [
                                {
                                    ts: 't:' + TS_ISO[0],
                                    v0: 'n:123',
                                    v1: 'n:456',
                                    v2: 'n:789'
                                },
                                {
                                    ts: 't:' + TS_ISO[1],
                                    v0: 'n:012',
                                    v1: 'n:345',
                                    v2: 'n:678'
                                },
                                {
                                    ts: 't:' + TS_ISO[2],
                                    v0: 'n:901',
                                    v1: 'n:234',
                                    v2: 'n:567'
                                }
                            ]
                        }
                    );

                    expect(status.row_ts).to.eql({
                        [TS_VAL[0]]: {
                            ts: 't:' + TS_ISO[0],
                            v0: 'n:111',
                            v1: 'n:222',
                            v2: 'n:333',
                            v3: 'n:123',
                            v4: 'n:456',
                            v5: 'n:789'
                        },
                        [TS_VAL[1]]: {
                            ts: 't:' + TS_ISO[1],
                            v0: 'n:444',
                            v1: 'n:555',
                            v2: 'n:666',
                            v3: 'n:012',
                            v4: 'n:345',
                            v5: 'n:678'
                        },
                        [TS_VAL[2]]: {
                            ts: 't:' + TS_ISO[2],
                            v0: 'n:777',
                            v1: 'n:888',
                            v2: 'n:999',
                            v3: 'n:901',
                            v4: 'n:234',
                            v5: 'n:567'
                        }
                    });
                });
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
                        gzip: true,
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
                        gzip: true,
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
