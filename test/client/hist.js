/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client history methods
 */
"use strict";

const stubs = require('../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const { verifyTokenCall, verifyRequestCall } = require("./utils");

describe('client', () => {
    describe('hisRead', () => {
        it('should generate GET hisRead with range as-is if given string', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisRead("my.id", "today");
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/hisRead",
                {},
                {
                    params: {
                        range: "\"today\"",
                        id: "@my.id"
                    },
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('should generate GET hisRead with range defined by times', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisRead(
                'my.id',
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z')
            );
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/hisRead",
                {},
                {
                    params: {
                        range: "\"2014-01-01T00:00:00.000Z UTC,2018-01-01T00:00:00.000Z UTC\"",
                        id: "@my.id"
                    },
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('given time range should require `from` to be a Date', () => {
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

        it('given time range should require `to` to be a Date', () => {
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

        it('should support reading more than one point', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisRead(
                ['my.pt.a', 'my.pt.b', 'my.pt.c'],
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z')
            );
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/hisRead",
                {},
                {
                    params: {
                        range: "\"2014-01-01T00:00:00.000Z UTC,2018-01-01T00:00:00.000Z UTC\"",
                        id0: "@my.pt.a",
                        id1: "@my.pt.b",
                        id2: "@my.pt.c"
                    },
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('should perform big reads in batches', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                let returnItem;
                if (uri === "/oauth2/token") {
                    returnItem = {
                        access_token: WS_ACCESS_TOKEN
                    };
                } else if (uri === "/api/hisRead") {
                    if (config.params.id0 === "@my.pt.a") {
                        returnItem = {
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
                        };
                    } else if (config.params.id0 === "@my.pt.d") {
                        returnItem = {
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
                        };
                    } else if (config.params.id0 === "@my.pt.g") {
                        returnItem = {
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
                        };
                    } else {
                        returnItem = {};
                    }
                }

                return Promise.resolve(returnItem);
            });

            const result = await ws.hisRead(
                [
                    'my.pt.a', 'my.pt.b', 'my.pt.c',
                    'my.pt.d', 'my.pt.e', 'my.pt.f',
                    'my.pt.g', 'my.pt.h', 'my.pt.i',
                ],
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z'),
                3
            );
            expect(result).to.deep.equal({
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

            expect(ws._wsRawSubmit.callCount).to.equal(4);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);

            const expectedArgs = [
                {},     // first one skipped as its verified earlier
                {
                    method: "GET",
                    uri: "/api/hisRead",
                    body: {},
                    config: {
                        params: {
                            "range": "\"2014-01-01T00:00:00.000Z UTC,2018-01-01T00:00:00.000Z UTC\"",
                            "id0": "@my.pt.a",
                            "id1": "@my.pt.b",
                            "id2": "@my.pt.c"
                        },
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json"
                        },
                        decompress: true
                    }
                },
                {
                    method: "GET",
                    uri: "/api/hisRead",
                    body: {},
                    config: {
                        params: {
                            'id0': '@my.pt.d',
                            'id1': '@my.pt.e',
                            'id2': '@my.pt.f',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                + '2018-01-01T00:00:00.000Z UTC"'
                        },
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json"
                        },
                        decompress: true
                    }
                },
                {
                    method: "GET",
                    uri: "/api/hisRead",
                    body: {},
                    config: {
                        params: {
                            'id0': '@my.pt.g',
                            'id1': '@my.pt.h',
                            'id2': '@my.pt.i',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                + '2018-01-01T00:00:00.000Z UTC"'
                        },
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json"
                        },
                        decompress: true
                    }
                }
            ];

            for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                const { method, uri, body, config } = expectedArgs[i];
                verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
            }
        });

        it('should merge the batch read grids\' results', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                let returnItem;
                if (uri === "/oauth2/token") {
                    returnItem = {
                        access_token: WS_ACCESS_TOKEN
                    };
                } else if (uri === "/api/hisRead") {
                    if (config.params.id0 === "@my.pt.a") {
                        returnItem = {
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
                        };
                    } else if (config.params.id0 === "@my.pt.d") {
                        returnItem = {
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
                        };
                    } else if (config.params.id0 === "@my.pt.g") {
                        returnItem = {
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
                        };
                    } else {
                        returnItem = {};
                    }
                }

                return Promise.resolve(returnItem);
            });

            const result = await ws.hisRead(
                [
                    'my.pt.a', 'my.pt.b', 'my.pt.c',
                    'my.pt.d', 'my.pt.e', 'my.pt.f',
                    'my.pt.g', 'my.pt.h', 'my.pt.i',
                ],
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z'),
                3
            );
            expect(result).to.deep.equal({
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

            expect(ws._wsRawSubmit.callCount).to.equal(4);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);

            const expectedArgs = [
                {},     // first one skipped as its verified earlier
                {
                    method: "GET",
                    uri: "/api/hisRead",
                    body: {},
                    config: {
                        params: {
                            'id0': '@my.pt.a',
                            'id1': '@my.pt.b',
                            'id2': '@my.pt.c',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                + '2018-01-01T00:00:00.000Z UTC"'
                        },
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json"
                        },
                        decompress: true
                    }
                },
                {
                    method: "GET",
                    uri: "/api/hisRead",
                    body: {},
                    config: {
                        params: {
                            'id0': '@my.pt.d',
                            'id1': '@my.pt.e',
                            'id2': '@my.pt.f',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                + '2018-01-01T00:00:00.000Z UTC"'
                        },
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json"
                        },
                        decompress: true
                    }
                },
                {
                    method: "GET",
                    uri: "/api/hisRead",
                    body: {},
                    config: {
                        params: {
                            'id0': '@my.pt.g',
                            'id1': '@my.pt.h',
                            'id2': '@my.pt.i',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                + '2018-01-01T00:00:00.000Z UTC"'
                        },
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: "application/json"
                        },
                        decompress: true
                    }
                }
            ];

            for (let i = 1; i < ws._wsRawSubmit.callCount - 1; i++) {
                const { method, uri, body, config } = expectedArgs[i];
                verifyRequestCall(ws._wsRawSubmit.getCall(i).args, method, uri, body, config);
            }
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
                            hisStart: TS_VAL[0],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[0],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[0],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[0],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[2],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[1],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: null,
                            hisEnd: TS_VAL[0],
                            colId: {},
                            rowTs: {}
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
                            hisStart: null,
                            hisEnd: TS_VAL[0],
                            colId: {},
                            rowTs: {}
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
                            hisStart: null,
                            hisEnd: TS_VAL[2],
                            colId: {},
                            rowTs: {}
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
                            hisStart: null,
                            hisEnd: TS_VAL[2],
                            colId: {},
                            rowTs: {}
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
                            hisStart: null,
                            hisEnd: TS_VAL[0],
                            colId: {},
                            rowTs: {}
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
                            hisStart: null,
                            hisEnd: TS_VAL[1],
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[0],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                            hisStart: TS_VAL[0],
                            hisEnd: null,
                            colId: {},
                            rowTs: {}
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
                        hisStart: TS_VAL[0],
                        hisEnd: null,
                        colId: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        rowTs: {}
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
                        hisStart: TS_VAL[0],
                        hisEnd: null,
                        colId: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        rowTs: {}
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
                        hisStart: TS_VAL[0],
                        hisEnd: null,
                        colId: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        rowTs: {}
                    };

                    try {
                        ws._mergeHisReadRes(
                            result, status,
                            [
                                'r:id0', 'r:id2', 'r:id3' /* id0 not in colId */
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

                it('should add rows to status.rowTs', () => {
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
                        hisStart: TS_VAL[0],
                        hisEnd: null,
                        colId: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        rowTs: {}
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

                    expect(status.rowTs).to.eql({
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
                        hisStart: TS_VAL[0],
                        hisEnd: null,
                        colId: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        rowTs: {}
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

                    expect(status.rowTs).to.eql({
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

                it('should add fields to existing rows in.rowTs', () => {
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
                        hisStart: TS_VAL[0],
                        hisEnd: null,
                        colId: {
                            'r:id1': 3,
                            'r:id2': 4,
                            'r:id3': 5
                        },
                        rowTs: {
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

                    expect(status.rowTs).to.eql({
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
        it('should generate POST with records in timestamp order', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                let returnItem;
                if (uri === "/oauth2/token") {
                    returnItem = {
                        access_token: WS_ACCESS_TOKEN
                    };
                } else if (uri === "/api/hisWrite") {
                    returnItem = "grid goes here";
                } else {
                    returnItem = {};
                }

                return Promise.resolve(returnItem);
            });

            const result = await ws.hisWrite({
                't:2016-01-02T00:00Z UTC': {
                    'r:my.id': 'n:123.45'
                },
                't:2016-01-01T00:00Z UTC': {
                    'r:my.id': 'n:234.56'
                },
                't:2016-02-01T00:00Z UTC': {
                    'r:my.id': 'n:631.42'
                }
            });
            expect(result).to.equal("grid goes here");
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisWrite",
                {
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
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('should support multiple points', async () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                let returnItem;
                if (uri === "/oauth2/token") {
                    returnItem = {
                        access_token: WS_ACCESS_TOKEN
                    };
                } else if (uri === "/api/hisWrite") {
                    returnItem = "grid goes here";
                } else {
                    returnItem = {};
                }

                return Promise.resolve(returnItem);
            });

            const result = await ws.hisWrite({
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
            });
            expect(result).to.equal("grid goes here");
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisWrite",
                {
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
                },
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

    describe('hisDelete', () => {
        const TEST_RANGE = "s:2023-05-13T05:14:30Z, 2023-05-14T05:14:30Z";

        it("should fail if no ids array is empty", async () => {
            const err_msg = "`ids` must contain at least one point UUID.";

            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete([], TEST_RANGE);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range does not provide any timestamp", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const err_msg = "An invalid hisRead range input was given: No range was given.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, "s:");
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range does not start with s:", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const err_msg = "An invalid hisRead range input was given: Missing `s:`.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, "last");
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range contains more than 2 timestamps", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-13T05:14:30Z, 2023-05-13T05:15:30Z, 2023-05-13T05:16:30Z"
            const err_msg = "An invalid hisRead range input was given: Number of timestamps cannot exceed 2.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range is invalid date", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-99"
            const err_msg = "An invalid hisRead range input was given: Invalid ISO8601 timestamp.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range is invalid dateTime", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-13T99:123:55Z";
            const err_msg = "An invalid hisRead range input was given: Invalid ISO8601 timestamp.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });

        it("should fail if range contains at least one invalid dateTime", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            const TEST_RANGE_INVALID = "s:2023-05-12T05:14:30Z, 2023-05-13T99:123:55Z";
            const err_msg = "An invalid hisRead range input was given: Invalid ISO8601 timestamp.";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                await ws.hisDelete(TEST_POINT, TEST_RANGE_INVALID);
                throw new Error("Should not have worked.");
            } catch (err) {
                if (err.message != err_msg) {
                    throw new Error(`Expected [${err_msg}], but got [${err.message}]`);
                }
            }
        });


        it("should generate the correct grid for a single point", async () => {
            const TEST_POINT = "b3b6be5a-cd9d-46ab-9fc5-837c1c583f79";
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisDelete(TEST_POINT, TEST_RANGE);
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisDelete",
                {
                    meta: {
                        ver: "2.0",
                    },
                    cols: [
                        {
                            name: "range",
                        },
                        {
                            name: "id",
                        },
                    ],
                    rows: [
                        {
                            range: TEST_RANGE,
                            id: `r:${TEST_POINT}`,
                        },
                    ],
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json",
                    },
                    decompress: true,
                }
            );
        });

        it("should generate the correct grid for an array of points", async () => {
            const TEST_POINTS = [
                "00000112-0000-0000-0000-000000000000",
                "99998000-0000-0000-0000-000000000000",
            ];
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            await ws.hisDelete(TEST_POINTS, TEST_RANGE);
            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyTokenCall(ws._wsRawSubmit.firstCall.args);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/hisDelete",
                {
                    meta: {
                        ver: "2.0",
                    },
                    cols: [
                        {
                            name: "range",
                        },
                        {
                            name: "id0",
                        },
                        {
                            name: "id1",
                        },
                    ],
                    rows: [
                        {
                            range: TEST_RANGE,
                            id0: `r:${TEST_POINTS[0]}`,
                            id1: `r:${TEST_POINTS[1]}`,
                        },
                    ],
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json",
                    },
                    decompress: true,
                }
            );
        });
    });
});
