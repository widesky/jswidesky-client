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

    describe('_create_or_update', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/CRUD_OP_HERE") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should automatically determine columns from entity data', async () => {
            const res = await ws._create_or_update('CRUD_OP_HERE', {
                /* Note the order isn't preserved by objects anyway */
                name: "s:testing",
                c: "n:1234",
                dis: "s:My test entity",
                b: true,
                a: "s:test",
                id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
            });
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/CRUD_OP_HERE",
                {
                    meta: {ver: "2.0"},
                    cols: [
                        /*
                         * `id`, `name` and `dis` will be first.
                         */
                        {name: "id"},
                        {name: "name"},
                        {name: "dis"},
                        {name: "a"},
                        {name: "b"},
                        {name: "c"}
                    ],
                    rows: [
                        {
                            id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                            a: "s:test", b: true, c: "n:1234",
                            dis: "s:My test entity", name: "s:testing"
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

        it('should automatically use Haystack 3.0 if needed', async () => {
            const res = await ws._create_or_update('CRUD_OP_HERE', {
                /* Note the order isn't preserved by objects anyway */
                name: "s:testing",
                c: ["n:1234", "n:2345", "n:3456"],
                dis: "s:My test entity",
                b: true,
                a: "s:test",
                id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
            });
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/CRUD_OP_HERE",
                {
                    meta: {ver: "3.0"},
                    cols: [
                        /*
                         * `id`, `name` and `dis` will be first.
                         */
                        {name: "id"},
                        {name: "name"},
                        {name: "dis"},
                        {name: "a"},
                        {name: "b"},
                        {name: "c"}
                    ],
                    rows: [
                        {
                            id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                            a: "s:test",
                            b: true,
                            c: [
                                "n:1234",
                                "n:2345",
                                "n:3456"
                            ],
                            dis: "s:My test entity",
                            name: "s:testing"
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

        it('should include all columns seen in all entities', async () => {
            const res = await ws._create_or_update('CRUD_OP_HERE', [
                {
                    name: "s:noid",
                    f: "t:2018-10-31T07:36+10:00 Brisbane",
                    dis: "s:Entity with dis and name",
                    e: "m:"
                },
                {
                    name: "s:nodis",
                    id: "r:364d7c7f-e227-40d6-a6aa-6e57d29ba311",
                    g: "r:aref",
                    b: false
                },
                {
                    name: "s:testing",
                    c: "n:1234",
                    dis: "s:Entity with id, dis and name",
                    b: true,
                    d: false,
                    a: "s:test",
                    id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
                }
            ]);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/CRUD_OP_HERE",
                {
                    meta: {ver: "2.0"},
                    cols: [
                        /*
                         * `id`, `name` and `dis` will be first.
                         */
                        {name: "id"},
                        {name: "name"},
                        {name: "dis"},
                        {name: "a"},
                        {name: "b"},
                        {name: "c"},
                        {name: "d"},
                        {name: "e"},
                        {name: "f"},
                        {name: "g"}
                    ],
                    rows: [
                        {
                            dis: "s:Entity with dis and name",
                            e: "m:",
                            f: "t:2018-10-31T07:36+10:00 Brisbane",
                            name: "s:noid"
                        },
                        {
                            b: false,
                            g: "r:aref",
                            id: "r:364d7c7f-e227-40d6-a6aa-6e57d29ba311",
                            name: "s:nodis"
                        },
                        {
                            id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                            a: "s:test", b: true, c: "n:1234", d: false,
                            dis: "s:Entity with id, dis and name",
                            name: "s:testing"
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
});