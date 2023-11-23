/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../../stubs');
const sinon = require('sinon');
const expect = require('chai').expect;
const getInstance = stubs.getInstance;
const Hs = require("../../../../src/utils/haystack");

const HIS_DELETE_ENTITY_BATCH_SIZE = 100;
const HIS_READ_LARGE_TIME_SERIES = {
    data: require("./files/hisRead_timeseries_large.json"),
    ids: [
        '0824d6c3-ebde-420d-96a4-272afe842190',
        '06037f10-bc06-4ddd-a58e-3fe2a975e830',
        '01912a1b-65fd-4449-b4e9-e8dc48e3b148',
        '0e2578db-90a3-4454-95d3-38565f26c0f6',
        '0e201c40-05bc-11ee-8644-ab3fe7a960b1'
    ]
};
const HIS_READ_SMALL_TIME_SERIES = {
    data: require("./files/hisRead_small.json"),
    ids: HIS_READ_LARGE_TIME_SERIES.ids
};
const HIS_READ_LARGE_ENTITIES = {
    data: require("./files/hisRead_entities_large.json"),
    ids: require("./files/hisRead_entites_ids.json")
};
const TIME_START = new Date(0);
const TIME_END = new Date();

function genEntities(source, num) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        entities.push({
            id: `r:${source[i]}`
        });
    }

    return entities;
}

describe("client.batch.hisDeleteByFilter", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.v2.find = sinon.stub().callsFake(() => []);
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
        ws.hisDelete = sinon.stub().callsFake(() => ["test"]);
    });

    describe("options not specified", () => {
        describe("entity payload smaller than default batchSize", () => {
            it("should create 1 request", async () => {
                const entities = genEntities(
                    HIS_READ_LARGE_ENTITIES.ids, HIS_DELETE_ENTITY_BATCH_SIZE - 4);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_LARGE_ENTITIES.data,
                        errors: []
                    };
                });
                await ws.batch.hisDeleteByFilter("point", TIME_START, TIME_END);
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.hisDelete.calledOnce).to.be.true;
                expect(ws.hisDelete.args[0]).to.eql([
                    entities.map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.010Z"
                ]);
            });
        });

        describe("entity payload larger than default batchSize", () => {
            it("should create more than 1 request", async () => {
                const entities = genEntities(
                    HIS_READ_LARGE_ENTITIES.ids, HIS_DELETE_ENTITY_BATCH_SIZE + 10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_LARGE_ENTITIES.data,
                        errors: []
                    };
                });
                await ws.batch.hisDeleteByFilter("point", TIME_START, TIME_END);
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.hisDelete.calledTwice).to.be.true;
                expect(ws.hisDelete.args[0]).to.eql([
                    entities
                        .slice(0, HIS_DELETE_ENTITY_BATCH_SIZE)
                        .map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.010Z"
                ]);
                expect(ws.hisDelete.args[1]).to.eql([
                    entities
                        .slice(HIS_DELETE_ENTITY_BATCH_SIZE)
                        .map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.010Z"
                ]);
            });
        });
    });

    describe("option batchSize", () => {
        describe("delete data smaller than batchSize", () => {
            it("should make 1 request", async () => {
                const entities = genEntities(
                    HIS_READ_LARGE_ENTITIES.ids, 12);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_LARGE_ENTITIES.data.slice(0, 12),
                        errors: []
                    };
                });
                await ws.batch.hisDeleteByFilter("point", TIME_START, TIME_END, {
                    batchSize: 15
                });
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.hisDelete.calledOnce).to.be.true;
                expect(ws.hisDelete.args[0]).to.eql([
                    entities.map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.010Z"
                ]);
            });
        });

        describe("delete data greater than batchSize", () => {
            it("should make more than 1 request", async () => {
                const entities = genEntities(
                    HIS_READ_SMALL_TIME_SERIES.ids, 5);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_SMALL_TIME_SERIES.data,
                        errors: []
                    };
                });
                await ws.batch.hisDeleteByFilter("point", TIME_START, TIME_END, {
                    batchSize: 2
                });
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.hisDelete.calledThrice).to.be.true;
                expect(ws.hisDelete.args[0]).to.eql([
                    entities.map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.002Z"
                ]);
                expect(ws.hisDelete.args[1]).to.eql([
                    entities.map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.002Z,1970-01-01T00:00:00.004Z"
                ]);
                expect(ws.hisDelete.args[2]).to.eql([
                    entities.map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.004Z,1970-01-01T00:00:00.005Z"
                ]);
            });
        });
    });

    describe("option batchSizeEntity", () => {
        describe("entities to delete data smaller than batchSizeEntity", () => {
            it("should make 1 request", async () => {
                const entities = genEntities(HIS_READ_SMALL_TIME_SERIES.ids, 5);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_SMALL_TIME_SERIES.data,
                        errors: []
                    };
                });
                await ws.batch.hisDeleteByFilter(
                    "points", TIME_START, TIME_END, {
                        batchSizeEntity: 10
                    }
                );
                expect(ws.hisDelete.calledOnce).to.be.true;
                expect(ws.hisDelete.args[0]).to.eql([
                    HIS_READ_SMALL_TIME_SERIES.ids, "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ]);
            });
        });

        describe("entities to delete data greater than batchSizeEntity", () => {
            it("should make more than 1 request", async () => {
                const entities = genEntities(HIS_READ_SMALL_TIME_SERIES.ids, 5);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_SMALL_TIME_SERIES.data,
                        errors: []
                    };
                });
                await ws.batch.hisDeleteByFilter(
                    "points", TIME_START, TIME_END, {
                        batchSizeEntity: 2
                    }
                );
                expect(ws.hisDelete.calledThrice).to.be.true;
                expect(ws.hisDelete.args[0]).to.eql([
                    HIS_READ_SMALL_TIME_SERIES.ids.slice(0, 2),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ]);
                expect(ws.hisDelete.args[1]).to.eql([
                    HIS_READ_SMALL_TIME_SERIES.ids.slice(2, 4),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ]);
                expect(ws.hisDelete.args[2]).to.eql([
                    HIS_READ_SMALL_TIME_SERIES.ids.slice(4),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ]);
            });
        });
    });

    describe("option limit", () => {
        it("should pass argument to client.v2.find", async () => {
            const entities = genEntities(HIS_READ_SMALL_TIME_SERIES.ids, 5);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            ws.batch.hisRead = sinon.stub().callsFake(() => {
                return {
                    success: HIS_READ_SMALL_TIME_SERIES.data,
                    errors: []
                };
            });
            await ws.batch.hisDeleteByFilter("point", TIME_START, TIME_END, {
                limit: 30
            });
            expect(ws.v2.find.calledOnce).to.be.true;
            expect(ws.v2.find.args[0]).to.eql(["point", 30])
        });
    });

    describe("option returnResult", () => {
        let entities;
        beforeEach(() => {
            ws.batch.hisRead = sinon.stub().callsFake(() => {
                return {
                    success: HIS_READ_SMALL_TIME_SERIES.data,
                    errors: []
                };
            });
            entities = genEntities(HIS_READ_SMALL_TIME_SERIES.ids, 5);
            ws.v2.find = sinon.stub().callsFake(() => entities);
        });

        describe("if enabled", () => {
            it("should return the result", async () => {
                const result = await ws.batch.hisDeleteByFilter(
                    HIS_READ_SMALL_TIME_SERIES.ids, TIME_START, TIME_END, {
                        returnResult: true
                    }
                );
                expect(result).to.eql({
                    success: [["test"]],
                    errors: []
                })
            });
        });

        describe("if not enabled", () => {
            it("should not return the result", async () => {
                const result = await ws.batch.hisDeleteByFilter(
                    HIS_READ_SMALL_TIME_SERIES.ids, TIME_START, TIME_END, {
                        returnResult: false
                    }
                );
                expect(result).to.eql({
                    success: [],
                    errors: []
                })
            });
        });
    });

    describe("error handling", () => {
        let entities;
        beforeEach(() => {
            entities = genEntities(HIS_READ_SMALL_TIME_SERIES.ids, 5);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            ws.batch.hisRead = sinon.stub().callsFake(() => {
                return {
                    success: HIS_READ_SMALL_TIME_SERIES.data,
                    errors: []
                };
            });
            ws.hisDelete = sinon.stub().callsFake(() => {
                throw new Error("Test error");
            });
        });

        it("should return encountered errors by hisDelete", async () => {
            const result = await ws.batch.hisDeleteByFilter(
                "bad filter", TIME_START, TIME_END);
            expect(result.errors.length).to.equal(1);
            expect(result.errors).to.eql([{
                args: [
                    "hisDelete",
                    HIS_READ_SMALL_TIME_SERIES.ids,
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ],
                error: "Test error"
            }]);
        });

        it("should handle errors encountered by hisDelete and return them", async () => {
            ws.hisDelete = sinon.stub().callsFake(() => {
                throw new Error("Not well");
            });

            const { success, errors } = await ws.batch.hisDeleteByFilter("bad filter", TIME_START, TIME_END);
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Not well",
                args: [
                    "hisDelete",
                    entities
                        .map((entity) => Hs.getId(entity)),
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ]
            });
        });

        it("should return errors encountered by hisRead", async () => {
            ws.batch.hisRead = sinon.stub().callsFake((...args) => {
                return {
                    success: [[], [], [], [], []],
                    errors: [{
                        error: "Bad hisRead",
                        args: ["hisRead", ...args]
                    }]
                };
            });
            const result = await ws.batch.hisDeleteByFilter(
                HIS_READ_SMALL_TIME_SERIES.ids, TIME_START, TIME_END);
            expect(result.errors.length).to.equal(1);
            expect(result.errors[0]).to.eql({
                error: "Bad hisRead",
                args: ["hisRead", HIS_READ_SMALL_TIME_SERIES.ids, TIME_START, TIME_END]
            });
        });

        it("should handle errors encountered by v2.filter and return them", async () => {
            ws.v2.find = sinon.stub().callsFake(() => {
                throw new Error("Bad filter");
            });


            const { success, errors } = await ws.batch.hisDeleteByFilter("bad filter", TIME_START, TIME_END);
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Bad filter",
                args: ["v2.find", "bad filter", 0]
            });
        });
    });
});