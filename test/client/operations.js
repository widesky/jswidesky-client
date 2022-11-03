/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;
const {verifyRequestCall} = require("./utils");
const {Ref} = require("../../src/data");


describe('client', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
    });

    describe('read', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/read") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate GET read if given single ID as a string', async () => {
            const res = await ws.read("my.id");
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/read",
                {},
                {
                    params: {
                        'id': '@my.id'
                    },
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('should generate GET read if given single ID in an array', async () => {
            const res = await ws.read(["my.id"]);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/read",
                {},
                {
                    params: {
                        'id': '@my.id'
                    },
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        it('should generate POST read if given multiple IDs', async () => {
            const res = await ws.read(['my.id1', 'my.id2']);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/read",
                {
                    meta: {ver: "2.0"},
                    cols: [{name: "id"}],
                    rows: [
                        {id: "r:my.id1"},
                        {id: "r:my.id2"}
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

        it("should generate POST read if one of the ID's is of type Ref", async () => {
            const res = await ws.read([
                'my.id1',
                'my.id2',
                new Ref("someId", "someDis")
            ]);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/read",
                {
                    meta: {ver: "2.0"},
                    cols: [{name: "id"}],
                    rows: [
                        {id: "r:my.id1"},
                        {id: "r:my.id2"},
                        {id: "r:someId someDis"}
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

        it("should reject if input of type object", async () => {
            try {
                await ws.read({a: 123});
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal(
                    "Parameter 'ids' is neither a single id or an array of id's."
                );
            }
        });

        it("should reject if input is an empty array", async () => {
            try {
                await ws.read([]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("An empty array of id's was given.");
            }
        });


        it("should reject if array input contains an invalid element of type object but not of type Ref", async () => {
            try {
                await ws.read(["id1", "id2", {a: 123}]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal(
                    "Parameter 'ids' contains an element that is of type object but not compatible with class " +
                    "Ref due to: clonee object 'id' property must be a string"
                );
            }
        });

        it("should reject if array input contains an invalid element of type number", async () => {
            try {
                await ws.read(["id1", "id2", 123]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal(
                    "Parameter 'ids' contains an element that is not a string. Found number."
                );
            }
        });
    });

    describe('query', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/graphql") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should wrap the GraphQL query and submit it', async () => {
            const res = await ws.query('graphql query here');
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/graphql",
                {
                    "query": "{ graphql query here }"
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

    describe('updatePassword', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/user/updatePassword") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should call up the updatePassword API', async () => {
            const res = await ws.updatePassword("helloWorld!");
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/user/updatePassword",
                {
                    newPassword: "helloWorld!"
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

        it('should reject empty password', async () => {
            try {
                await ws.updatePassword("");
                throw new Error('Should not have succeeded');
            } catch (err) {
                expect(err.message).to.equal('New password cannot be empty.');
            }
        });
    });

    /* read-by-filter is handled by the `find` method */
    describe('find', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/read") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate GET read if given a filter and no limit', async () => {
            const res = await ws.find('myTag=="my value"');
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/read",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true,
                    params: {
                        filter: 'myTag=="my value"',
                        limit: 0
                    }
                }
            );
        });

        it('should include the limit if given', async () => {
            const res = await ws.find('myTag=="my value"', 30);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/read",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true,
                    params: {
                        filter: 'myTag=="my value"',
                        limit: 30
                    }
                }
            );
        });

        it("should reject if filter is not of type string", async () => {
           try {
               await ws.find(123, 30);
               throw new Error("Should not have worked");
           } catch (error) {
               expect(error.message).to.equal("Invalid filter type number given. Expected string.")
           }
        });

        it("should reject if limit is negative", async () => {
            try {
                await ws.find("my filter", -1);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Invalid negative limit given.")
            }
        });
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

    describe('create', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/createRec") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate createRec request', async () => {
            const res = await ws.create({
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
                "/api/createRec",
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
                            a: "s:test",
                            b: true,
                            c: "n:1234",
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

        it('should not require `id`', async () => {
            const res = await ws.create({
                name: "s:testing",
                c: "n:1234",
                dis: "s:My test entity",
                b: true,
                a: "s:test"
            });
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/createRec",
                {
                    meta: {ver: "2.0"},
                    cols: [
                        /*
                         * `name` and `dis` will be first.
                         */
                        {name: "name"},
                        {name: "dis"},
                        {name: "a"},
                        {name: "b"},
                        {name: "c"}
                    ],
                    rows: [
                        {
                            a: "s:test",
                            b: true,
                            c: "n:1234",
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
    });

    describe('update', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/updateRec") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate updateRec request', async () => {
            const res = await ws.update({
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
                "/api/updateRec",
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

        it('should require `id`', async () => {
            try {
                await ws.update({
                    name: "s:testing",
                    c: "n:1234",
                    dis: "s:My test entity",
                    b: true,
                    a: "s:test",
                });
                throw new Error('This should not have worked');
            } catch (err) {
                expect(err.message).to.equal("id is missing");
            }
        });
    });

    describe('deleteById', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/deleteRec") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate GET delete if given single ID as a string', async () => {
            const res = await ws.deleteById('my.id');
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/deleteRec",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true,
                    params: {
                        id: "@my.id"
                    }
                }
            );
        });

        it('should generate GET delete if given single ID in an array', async () => {
            const res = await ws.deleteById(['my.id']);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/deleteRec",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true,
                    params: {
                        id: "@my.id"
                    }
                }
            );
        });

        it('should generate POST deleteById if given multiple IDs', async () => {
            const res = await ws.deleteById(['my.id1', 'my.id2']);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/deleteRec",
                {
                    meta: {ver: "2.0"},
                    cols: [{name: "id"}],
                    rows: [
                        {id: "r:my.id1"},
                        {id: "r:my.id2"}
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

        it("should generate POST read if one of the ID's is of type Ref", async () => {
            const res = await ws.deleteById([
                'my.id1',
                'my.id2',
                new Ref("someId", "someDis")
            ]);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/api/deleteRec",
                {
                    meta: {ver: "2.0"},
                    cols: [{name: "id"}],
                    rows: [
                        {id: "r:my.id1"},
                        {id: "r:my.id2"},
                        {id: "r:someId someDis"}
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

        it("should reject if input of type object", async () => {
            try {
                await ws.deleteById({a: 123});
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal(
                    "Parameter 'ids' is neither a single id or an array of id's."
                );
            }
        });

        it("should reject if input is an empty array", async () => {
            try {
                await ws.deleteById([]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("An empty array of id's was given.");
            }
        });

        it("should reject if array input contains an invalid element of type object but not of type Ref", async () => {
            try {
                await ws.deleteById(["id1", "id2", {a: 123}]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal(
                    "Parameter 'ids' contains an element that is of type object but not compatible with class " +
                    "Ref due to: clonee object 'id' property must be a string"
                );
            }
        });

        it("should reject if array input contains an invalid element of type number", async () => {
            try {
                await ws.deleteById(["id1", "id2", 123]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal(
                    "Parameter 'ids' contains an element that is not a string. Found number."
                );
            }
        });
    });

    /* read-by-filter is handled by the `find` method */
    describe('deleteByFilter', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/deleteRec") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should generate GET delete if given a filter and no limit', async () => {
            const res = await ws.deleteByFilter('myTag=="my value"');
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/deleteRec",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true,
                    params: {
                        filter: 'myTag=="my value"',
                        limit: 0
                    }
                }
            );
        });

        it('should include the limit if given', async () => {
            const res = await ws.deleteByFilter('myTag=="my value"', 30);
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "GET",
                "/api/deleteRec",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true,
                    params: {
                        filter: 'myTag=="my value"',
                        limit: 30
                    }
                }
            );
        });

        it("should reject if filter is not of type string", async () => {
            try {
                await ws.deleteByFilter(123, 30);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Invalid filter type number given. Expected string.")
            }
        });

        it("should reject if limit is negative", async () => {
            try {
                await ws.deleteByFilter("my filter", -1);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Invalid negative limit given.")
            }
        });
    });
});
