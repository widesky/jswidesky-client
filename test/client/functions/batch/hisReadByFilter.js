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

const HIS_READ_BATCH_SIZE = 100;

function genEntities(num) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        entities.push(`id-${i}`);
    }

    return entities;
}

describe("client.batch.hisReadByFilter", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.findAsId = sinon.stub().callsFake(() => []);
        ws.hisRead = sinon.stub().callsFake((ids, start, end, batchSize) =>  {
            return {
                rows: [
                    {
                        "ts": "t:1970-01-01T00:00:00.000Z",
                        "v0": "n:0",
                        "v1": "n:1",
                        "v2": "n:2",
                        "v3": "n:3",
                        "v4": "n:4"
                    },
                ]
            };
        });
    });

    describe("options not specified", () => {
        describe("entity payload smaller than default batchSize", () => {
            it("should hisRead 1 request", async () => {
                const entities = genEntities(HIS_READ_BATCH_SIZE - 4)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.hisReadByFilter("point", "start", "end");
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.hisRead.calledOnce).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    entities,
                    "start",
                    "end",
                    HIS_READ_BATCH_SIZE
                ]);
            });
        });

        describe("entity payload larger than default batchSize", () => {
            it("should hisRead more than 1 request", async () => {
                const entities = genEntities(HIS_READ_BATCH_SIZE + 10)
                ws.findAsId = sinon.stub().callsFake(() => entities);
                await ws.batch.hisReadByFilter("point", "start", "end");
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.hisRead.calledTwice).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    entities.slice(0, HIS_READ_BATCH_SIZE),
                    "start",
                    "end",
                    HIS_READ_BATCH_SIZE
                ]);
                expect(ws.hisRead.args[1]).to.eql([
                    entities.slice(HIS_READ_BATCH_SIZE),
                    "start",
                    "end",
                    HIS_READ_BATCH_SIZE
                ]);
            });
        });
    });

    describe("option batchSize", () => {
        describe("entity payload smaller than batchSize", () => {
            it("should hisRead 1 request", async () => {
                const entities = genEntities(10)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.hisReadByFilter("point", "start", "end", {
                    batchSize: 11
                });
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.hisRead.calledOnce).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    entities,
                    "start",
                    "end",
                    11
                ]);
            });
        });

        describe("entity payload larger than batchSize", () => {
            it("should hisRead more than 1 request", async () => {
                const entities = genEntities(10)
                ws.findAsId = sinon.stub().callsFake(() => [...entities]);
                await ws.batch.hisReadByFilter("point", "start", "end", {
                    batchSize: 6
                });
                expect(ws.findAsId.calledOnce).to.be.true;
                expect(ws.hisRead.calledTwice).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    entities.slice(0, 6),
                    "start",
                    "end",
                    6
                ]);
                expect(ws.hisRead.args[1]).to.eql([
                    entities.slice(6),
                    "start",
                    "end",
                    6
                ]);
            });
        });
    });

    describe("option limit", () => {
        it("should pass argument to client.v2.find", async () => {
            const entities = genEntities(HIS_READ_BATCH_SIZE + 10)
            ws.findAsId = sinon.stub().callsFake(() => [...entities]);
            await ws.batch.hisReadByFilter("point", "start", "end", {
                limit: 30
            });
            expect(ws.findAsId.calledOnce).to.be.true;
            expect(ws.findAsId.args[0]).to.eql(["point", 30])
        });
    });

    describe("error handling", () => {
        beforeEach(() => {
            ws.hisRead = sinon.stub().callsFake(() =>  {
                return {
                    rows: [
                        {
                            ts: "t:2023-10-10T00:00:00Z",
                            val: "n:123"
                        }
                    ]
                };
            });
        });

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


            const { success, errors } = await ws.batch.hisReadByFilter("bad filter", "start", "end");
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Invalid name start char (end of stream)",
                args: ["findAsId", "bad filter", 0]
            });
        });

        it("should handle errors encountered by hisRead and return them", async () => {
            const entities = genEntities(2);
            ws.findAsId= sinon.stub().callsFake(() => [...entities]);
            ws.hisRead = sinon.stub().callsFake(() => {
                throw new Error("Not well");
            });

            const { success, errors } = await ws.batch.hisReadByFilter("bad filter", "start", "end");
            expect(success.length).to.equal(2);
            expect(success).to.eql([[], []]);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Not well",
                args: [
                    "hisRead",
                    entities,
                    "start",
                    "end",
                    HIS_READ_BATCH_SIZE
                ]
            });
        });
    });
});