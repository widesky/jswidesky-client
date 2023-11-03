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
});