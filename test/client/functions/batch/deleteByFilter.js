/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../../stubs');
const sinon = require('sinon');
const {RequestError} = require("../../../../src/errors");
const expect = require('chai').expect;
const getInstance = stubs.getInstance;

const DELETE_BATCH_SIZE = 30;

function genEntities(num) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        entities.push(`id-${i}`);
    }

    return entities;
}

describe("client.batch.deleteByFilter", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.findAsId = sinon.stub().callsFake(() => []);
        ws.deleteById = sinon.stub().callsFake((entities) =>  {
            return {
                rows: entities
            };
        });
    });

    describe("options not specified", () => {
        describe("entity payload smaller than default batchSize", () => {
            it("should deleteById 1 request", async () => {
                const entities = genEntities(DELETE_BATCH_SIZE - 4)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.deleteByFilter("point");
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.deleteById.calledOnce).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([entities]);
            });
        });

        describe("entity payload larger than default batchSize", () => {
            it("should deleteById more than 1 request", async () => {
                const entities = genEntities(DELETE_BATCH_SIZE + 10)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.deleteByFilter("point");
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.deleteById.calledTwice).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([
                    entities.slice(0, DELETE_BATCH_SIZE)
                ]);
                expect(ws.deleteById.args[1]).to.eql([
                    entities.slice(DELETE_BATCH_SIZE)
                ]);
            });
        });
    });

    describe("option batchSize", () => {
        describe("entity payload smaller than batchSize", () => {
            it("should deleteById 1 request", async () => {
                const entities = genEntities(10)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.deleteByFilter("point", 0, {
                    batchSize: 11
                });
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.deleteById.calledOnce).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([entities]);
            });
        });

        describe("entity payload larger than batchSize", () => {
            it("should deleteById more than 1 request", async () => {
                const entities = genEntities(10)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.deleteByFilter("point", 0, {
                    batchSize: 6
                });
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.deleteById.calledTwice).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([
                    entities.slice(0, 6)
                ]);
                expect(ws.deleteById.args[1]).to.eql([
                    entities.slice(6)
                ]);
            });
        });
    });

    describe("option returnResult", () => {
        describe("enabled", () => {
            it("should return result", async () => {
                const entities = genEntities(2);
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                const { success, errors} = await ws.batch.deleteByFilter("point", 0, {
                    returnResult: true
                });
                expect(success).to.eql([{
                    rows: entities
                }]);
                expect(errors.length).to.equal(0);
            });
        });

        describe("disabled", () => {
            it("should not return result", async () => {
                const entities = genEntities(2);
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                const { success, errors} = await ws.batch.deleteByFilter("point", 0, {
                    returnResult: false
                });
                expect(success.length).to.equal(0);
                expect(errors.length).to.equal(0);
            });
        });
    });

    describe("error handling", () => {
        it("should handle errors encountered by v2.filter and return them", async () => {
            ws.findAsId = sinon.stub().callsFake(() => {
                const fakeError = new Error("test");
                fakeError.response = {
                    data: {
                        errors: [
                            {
                                "locations": [
                                    {
                                        "column": 3,
                                        "line": 4
                                    }
                                ],
                                "message": "Invalid name start char (end of stream)"
                            }
                        ]
                    }
                }
                throw RequestError.make(fakeError);
            });

            const { success, errors } = await ws.batch.deleteByFilter("bad filter");
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Invalid name start char (end of stream)",
                args: ["findAsId", "bad filter", 0]
            });
        });

        it("should handle errors encountered by deleteById and return them", async () => {
            const entities = genEntities(2);
            ws.findAsId = sinon.stub().callsFake(() => [...entities]);
            ws.deleteById = sinon.stub().callsFake(() => {
                throw new Error("Not well");
            });

            const { success, errors } = await ws.batch.deleteByFilter("bad filter");
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Not well",
                args: [
                    "deleteById",
                    entities
                ]
            });
        });
    });
});