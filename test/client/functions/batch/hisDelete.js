"use strict";

const stubs = require('../../../stubs');
const sinon = require('sinon');
const expect = require('chai').expect;
const getInstance = stubs.getInstance;

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
}

describe("client", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.hisDelete = sinon.stub();
        ws.batch.hisRead = sinon.stub();
    });

    describe("performOpInBatch with op hisDelete", () => {
        it("should pass Array of ranges with ids", async () => {
            const ids = ["123", "456", "789"];
            await ws.performOpInBatch(
                "hisDelete",
                [["range1a,range1b", "range2a,range2b", "range3a,range3b"]],
                {
                    batchSize: 1,           // batches are based on the time ranges to be deleted
                    transformer: (batch) => [ids, batch[0]]
                }
            );
            expect(ws.hisDelete.calledThrice).to.be.true;
            expect(ws.hisDelete.args[0]).eql([ids, "range1a,range1b"]);
            expect(ws.hisDelete.args[1]).eql([ids, "range2a,range2b"]);
            expect(ws.hisDelete.args[2]).eql([ids, "range3a,range3b"]);
        });
    });

    describe("batch.hisDelete", () => {
        describe("no options specified", () => {
            describe("time series rows", () => {
                describe("payload smaller than default batch size of 100", () => {
                    it("should only make 1 request", async () => {
                        ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                        await ws.batch.hisDelete(
                            HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                        expect(ws.hisDelete.calledOnce).to.be.true;
                        expect(ws.hisDelete.args[0]).to.eql([
                            HIS_READ_SMALL_TIME_SERIES.ids,
                            "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                        ]);
                    });

                    describe("payload greater than default batch size of 100", () => {
                        it("should make more than 1 request", async () => {
                            ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_LARGE_TIME_SERIES.data);
                            await ws.batch.hisDelete(
                                HIS_READ_LARGE_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                            expect(ws.hisDelete.calledTwice).to.be.true;
                            expect(ws.hisDelete.args[0]).to.eql([
                                HIS_READ_LARGE_TIME_SERIES.ids,
                                "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:01.500Z"
                            ]);
                            expect(ws.hisDelete.args[1]).to.eql([
                                HIS_READ_LARGE_TIME_SERIES.ids,
                                "s:1970-01-01T00:00:01.500Z,1970-01-01T00:00:01.700Z"
                            ]);
                        });
                    });
                });

                describe("entities", () => {
                    describe("entities smaller than maximum of 100", () => {
                        it("should only make 1 request", async () => {
                            ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                            await ws.batch.hisDelete(
                                HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                            expect(ws.hisDelete.calledOnce).to.be.true;
                            expect(ws.hisDelete.args[0]).to.eql([
                                HIS_READ_SMALL_TIME_SERIES.ids,
                                "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                            ]);
                        });
                    });

                    describe("entities greater than maximum of 100", () => {
                        it("should make more than 1 request", async () => {
                            ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_LARGE_ENTITIES.data);
                            await ws.batch.hisDelete(
                                HIS_READ_LARGE_ENTITIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                            expect(ws.hisDelete.calledTwice).to.be.true;
                            expect(ws.hisDelete.args[0]).to.eql([
                                HIS_READ_LARGE_ENTITIES.ids.slice(0, 100),
                                "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.010Z"
                            ]);
                            expect(ws.hisDelete.args[1]).to.eql([
                                HIS_READ_LARGE_ENTITIES.ids.slice(100),
                                "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.010Z"
                            ]);
                        });
                    });
                });
            });
        });

        describe("option batchSize", () => {
            describe("delete data smaller than batchSize", () => {
                it("should make 1 request", async () => {
                    ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                    await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
                            batchSize: 12
                        }
                    );
                    expect(ws.hisDelete.calledOnce).to.be.true;
                    expect(ws.hisDelete.args[0]).to.eql([
                        HIS_READ_SMALL_TIME_SERIES.ids, "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                    ]);
                });
            });

            describe("delete data greater than batchSize", () => {
                it("should make more than 1 request", async () => {
                    ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                    await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
                            batchSize: 2
                        }
                    );
                    expect(ws.hisDelete.calledThrice).to.be.true;
                    expect(ws.hisDelete.args[0]).to.eql([
                        HIS_READ_SMALL_TIME_SERIES.ids, "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.002Z"
                    ]);
                    expect(ws.hisDelete.args[1]).to.eql([
                        HIS_READ_SMALL_TIME_SERIES.ids, "s:1970-01-01T00:00:00.002Z,1970-01-01T00:00:00.004Z"
                    ]);
                    expect(ws.hisDelete.args[2]).to.eql([
                        HIS_READ_SMALL_TIME_SERIES.ids, "s:1970-01-01T00:00:00.004Z,1970-01-01T00:00:00.005Z"
                    ]);
                });
            });
        });

        describe("option batchSizeEntity", () => {
            describe("entities to delete data smaller than batchSizeEntity", () => {
                it("should make 1 request", async () => {
                    ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                    await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
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
                    ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                    await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
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

        describe("option returnResult", () => {
            beforeEach(() => {
                ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                ws.hisDelete = sinon.stub().callsFake(() => ["test123"]);
            });

            describe("if enabled", () => {
                it("should return the result", async () => {
                    const result = await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
                            returnResult: true
                        }
                    );
                    expect(result).to.eql({
                        success: [["test123"]],
                        errors: []
                    })
                });
            });

            describe("if not enabled", () => {
                it("should not return the result", async () => {
                    const result = await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
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
            beforeEach(() => {
                ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_SMALL_TIME_SERIES.data);
                ws.hisDelete = sinon.stub().callsFake(() => {
                    throw new Error("Test error");
                });
            });

            it("should return encountered errors and arguments used", async () => {
                const result = await ws.batch.hisDelete(
                    HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                expect(result.errors.length).to.equal(1);
                expect(result.errors).to.eql([{
                    args: [HIS_READ_SMALL_TIME_SERIES.ids, "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"],
                    error: "Test error"
                }]);
            });
        });
    });
});