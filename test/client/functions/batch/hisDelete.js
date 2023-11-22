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
};
const HIS_READ_TIME_SERIES_MIX = {
    data: require("./files/hisRead_mix.json"),
    ids: [
        "06037f10-bc06-4ddd-a58e-3fe2a975e830",
        "0e2578db-90a3-4454-95d3-38565f26c0f6",
        "105b1cd6-cb74-449e-9389-50165328a9e3",
        "1a669067-d59b-4e29-b564-9c84e3784aeb",
        "2fefaf25-555a-4184-94bc-abae4ec8d012",
        "37cfffce-fccc-454d-b5ee-cd7999ace8bf",
        "40685948-db22-414b-9e2e-530fc16cd576",
        "439bec63-2903-40fa-9547-99096173c92f",
        "68502133-c34f-43a0-8875-7ddd6f6311bb",
        "7b50c5ad-13fd-4a17-a1d2-c589de55cce3"
    ]
};

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
        describe("argument range", () => {
            it("should reject if given '2023-10-10T00:00:00Z'", async () => {
                try {
                    await ws.batch.hisDelete(["123"], "2023-10-10T00:00:00Z");
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("'range' parameter is not a valid hisRead range")
                }
            });

            it("should reject if 'from' part of range is not a valid Date", async () => {
                try {
                    await ws.batch.hisDelete(["123"], "2023-10-10T00:00:00A,2023-10-10T10:00:00Z");
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("'range' parameter is not a valid hisRead range")
                }
            });

            it("should reject if 'to' part of range is not a valid Date", async () => {
                try {
                    await ws.batch.hisDelete(["123"], "2023-10-10T00:00:00Z,2023-10-10T10:00:00A");
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("'range' parameter is not a valid hisRead range")
                }
            });
        });

        describe("time range batch behaviour", () => {
            describe("mix time series ranges", () => {
                beforeEach(() => {
                    ws.batch.hisRead = sinon.stub().callsFake(() => {
                        return {
                            success: HIS_READ_TIME_SERIES_MIX.data,
                            errors: []
                        };
                    });
                });

                it("should create all time ranges", async () => {
                    await ws.batch.hisDelete(HIS_READ_TIME_SERIES_MIX.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                    expect(ws.hisDelete.callCount).to.equal(8);
                    const expectedRanges = [
                        "s:2022-12-17T16:30:00.000Z,2022-12-23T12:25:00.001Z",
                        "s:2022-12-23T12:25:00.001Z,2022-12-29T10:55:00.001Z",
                        "s:2022-12-29T10:55:00.001Z,2023-01-04T09:25:00.001Z",
                        "s:2023-01-04T09:25:00.001Z,2023-01-10T07:55:00.001Z",
                        "s:2023-01-10T07:55:00.001Z,2023-01-16T06:25:00.001Z",
                        "s:2023-01-16T06:25:00.001Z,2023-01-22T04:55:00.001Z",
                        "s:2023-01-22T04:55:00.001Z,2023-01-28T03:25:00.001Z",
                        "s:2023-01-28T03:25:00.001Z,2023-04-30T14:00:00.001Z"
                    ];
                    for (let i = 0; i < ws.hisDelete.callCount; i++) {
                        expect(ws.hisDelete.args[i]).to.eql([
                            HIS_READ_TIME_SERIES_MIX.ids, expectedRanges[i]
                        ], `index=${i}`);
                    }
                });
            });
        });

        describe("no options specified", () => {
            describe("time series rows", () => {
                describe("payload smaller than default batch size of 100", () => {
                    it("should only make 1 request", async () => {
                        ws.batch.hisRead = sinon.stub().callsFake(() => {
                            return {
                                success: HIS_READ_SMALL_TIME_SERIES.data,
                                errors: []
                            }
                        });
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
                            ws.batch.hisRead = sinon.stub().callsFake(() => {
                                return {
                                    success: HIS_READ_LARGE_TIME_SERIES.data,
                                    errors: []
                                };
                            });
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
                            ws.batch.hisRead = sinon.stub().callsFake(() => {
                                return {
                                    success: HIS_READ_SMALL_TIME_SERIES.data,
                                    errors: []
                                };
                            });
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
                            ws.batch.hisRead = sinon.stub().callsFake(() => {
                                return {
                                    success: HIS_READ_LARGE_ENTITIES.data,
                                    errors: []
                                };
                            });
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
                    ws.batch.hisRead = sinon.stub().callsFake(() => {
                        return {
                            success: HIS_READ_SMALL_TIME_SERIES.data,
                            errors: HIS_READ_SMALL_TIME_SERIES.data
                        };
                    });
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
                    ws.batch.hisRead = sinon.stub().callsFake(() => {
                        return {
                            success: HIS_READ_SMALL_TIME_SERIES.data,
                            errors: []
                        };
                    });
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
                    ws.batch.hisRead = sinon.stub().callsFake(() => {
                        return {
                            success: HIS_READ_SMALL_TIME_SERIES.data,
                            errors: []
                        };
                    });
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
                    ws.batch.hisRead = sinon.stub().callsFake(() => {
                        return {
                            success: HIS_READ_SMALL_TIME_SERIES.data,
                            errors: []
                        };
                    });
                    await ws.batch.hisDelete(
                        HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z", {
                            batchSizeEntity: 1
                        }
                    );
                    expect(ws.hisDelete.callCount).to.be.equal(5);
                    for (let i = 0; i < ws.hisDelete.callCount; i++) {
                        expect(ws.hisDelete.args[i]).to.eql([
                            [HIS_READ_SMALL_TIME_SERIES.ids[i]],
                            "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                        ], `Index ${i}`);
                    }
                });
            });
        });

        describe("option returnResult", () => {
            beforeEach(() => {
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_SMALL_TIME_SERIES.data,
                        errors: []
                    };
                });
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
                ws.batch.hisRead = sinon.stub().callsFake((...args) => {
                    return {
                        success: [],
                        errors: [{
                            error: "hisRead error",
                            args: ["hisRead", ...args]
                        }]
                    };
                });
                ws.hisDelete = sinon.stub().callsFake(() => {
                    throw new Error("hisDelete error");
                });
            });

            it("should return encountered errors and arguments used for hisDelete", async () => {
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: HIS_READ_SMALL_TIME_SERIES.data,
                        errors: []
                    };
                });
                const result = await ws.batch.hisDelete(
                    HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                expect(result.errors.length).to.equal(1);
                expect(result.errors).to.eql([{
                    args: [
                        "hisDelete",
                        HIS_READ_SMALL_TIME_SERIES.ids,
                        "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                    ],
                    error: "hisDelete error"
                }]);
            });

            it("should return encountered errors and arguments used for hisRead", async () => {
                const result = await ws.batch.hisDelete(
                    HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                expect(result.success.length).to.equal(0);
                expect(result.errors.length).to.equal(1);
                const { args, error } = result.errors[0];
                expect(error).to.equal("hisRead error");
                expect(args[0]).to.equal("hisRead");
                expect(args[1]).to.eql(HIS_READ_SMALL_TIME_SERIES.ids);
                expect(args[2].valueOf()).to.equal(new Date(Date.parse("1970-01-01T00:00:00.000Z")).valueOf());
                expect(args[3].valueOf()).to.equal(new Date(Date.parse("2023-10-10T00:00:00Z")).valueOf());
            });

            it("should return encountered errors and arguments from both hisRead and hisDelete", async () => {
                ws.batch.hisRead = sinon.stub().callsFake(() => {
                    return {
                        success: [
                            HIS_READ_SMALL_TIME_SERIES.data[0],
                            [],
                            ...HIS_READ_SMALL_TIME_SERIES.data.slice(2)
                        ],
                        errors: [
                            {
                                error: "hisRead error",
                                args: [
                                    "hisRead",
                                    [HIS_READ_SMALL_TIME_SERIES.ids[1]],
                                    new Date(Date.parse("1970-01-01T00:00:00Z")),
                                    new Date(Date.parse("2023-10-10T00:00:00Z"))
                                ]
                            }
                        ]
                    };
                });
                const { success, errors } = await ws.batch.hisDelete(
                    HIS_READ_SMALL_TIME_SERIES.ids, "1970-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                expect(success.length).to.equal(0);
                expect(errors.length).to.equal(2);
                const { args: hisReadArgs, error: hisReadError } = errors[0];
                expect(hisReadError).to.equal("hisRead error");
                expect(hisReadArgs[0]).to.equal("hisRead");
                expect(hisReadArgs[1]).to.eql([HIS_READ_SMALL_TIME_SERIES.ids[1]]);
                expect(hisReadArgs[2].valueOf()).to.equal(new Date(Date.parse("1970-01-01T00:00:00.000Z")).valueOf());
                expect(hisReadArgs[3].valueOf()).to.equal(new Date(Date.parse("2023-10-10T00:00:00Z")).valueOf());
                const { args: hisDeleteArgs, error: hisDeleteError} = errors[1];
                expect(hisDeleteArgs).to.eql([
                    "hisDelete",
                    [HIS_READ_SMALL_TIME_SERIES.ids[0], ...HIS_READ_SMALL_TIME_SERIES.ids.slice(2)],
                    "s:1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.005Z"
                ]);
                expect(hisDeleteError).to.equal("hisDelete error");
            });
        });
    });
});