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

const HIS_READ_BATCH_SIZE = 100;
const HIS_READ_RESPONSE_SINGLE = require("./files/hisRead_smallSingle.json");
const HIS_READ_RESPONSE_SINGLE_IDS = ["0e6562a0-05bc-11ee-8644-ab3fe7a960b1"];
const HIS_READ_RESPONSE_MULTI = require("./files/hisRead_smallMulti.json");
const HIS_READ_RESPONSE_MULTI_IDS = [
    '0df080c0-05bc-11ee-8644-ab3fe7a960b1',
    '0c1f66e3-7666-4cb6-8f7a-62b48101cc64',
    '0bf95511-ec6c-4990-8555-b98ef44ec22b',
    '0eddc6f0-05bc-11ee-8644-ab3fe7a960b1',
    '0eb61ab0-05bc-11ee-8644-ab3fe7a960b1'
];

describe("client.batch.hisRead", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
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

    describe("no options specified", () => {
        describe("payload smaller than default batch size of 100", () => {
            it("should only make 1 request", async() => {
                await ws.batch.hisRead(["id1"], "start", "end");
                expect(ws.hisRead.calledOnce).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([["id1"], "start", "end", HIS_READ_BATCH_SIZE]);
            });
        });

        describe("payload larger than default batch size of 100", () => {
            beforeEach(() => {
                ws.hisRead = sinon.stub().callsFake(() =>  {
                    return {
                        cols: HIS_READ_RESPONSE_MULTI.cols,
                        rows: [
                            HIS_READ_RESPONSE_MULTI.rows[0]
                        ]
                    };
                });
            });

            it("should only make 2 requests", async () => {
                const ids = [];
                for (let i = 0; i < 150 ; i++) {
                    ids.push(`id${i}`);
                }
                await ws.batch.hisRead(ids, "start", "end");
                expect(ws.hisRead.calledTwice).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    ids.slice(0, HIS_READ_BATCH_SIZE), "start", "end", HIS_READ_BATCH_SIZE]
                );
                expect(ws.hisRead.args[1]).to.eql([
                    ids.slice(HIS_READ_BATCH_SIZE), "start", "end", HIS_READ_BATCH_SIZE
                ]);
            });
        });

        it("should return result", async () => {
            const result = await ws.batch.hisRead(["id1"], "start", "end");
            expect(result).to.eql({
                success: [[
                    {
                        ts: "t:2023-10-10T00:00:00Z",
                        val: "n:123"
                    }
                ]],
                errors: []
            });
        });
    });

    describe("option batchSize", async () => {
        describe("payload smaller than batchSize", () => {
            beforeEach(() => {
                ws.hisRead = sinon.stub().callsFake(() =>  {
                    return {
                        cols: HIS_READ_RESPONSE_MULTI.cols,
                        rows: [
                            HIS_READ_RESPONSE_MULTI.rows[0]
                        ]
                    };
                });
            });

            it("should send 1 request", async () => {
                const ids = ["id0", "id1", "id2", "id3", "id4"];
                await ws.batch.hisRead(ids, "start", "end", {
                    batchSize: 10
                });
                expect(ws.hisRead.calledOnce).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    ids, "start", "end", 10]
                );
            });
        });

        describe("payload larger than batchSize", () => {
            beforeEach(() => {
                ws.hisRead = sinon.stub().callsFake(() =>  {
                    return {
                        cols: HIS_READ_RESPONSE_MULTI.cols,
                        rows: [
                            HIS_READ_RESPONSE_MULTI.rows[0]
                        ]
                    };
                });
            });

            it("should send multiple requests", async () => {
                const ids = ["id0", "id1", "id2", "id3", "id4"];
                await ws.batch.hisRead(ids, "start", "end", {
                    batchSize: 2
                });
                expect(ws.hisRead.calledThrice).to.be.true;
                expect(ws.hisRead.args[0]).to.eql([
                    ["id0", "id1"], "start", "end", 2]
                );
                expect(ws.hisRead.args[1]).to.eql([
                    ["id2", "id3"], "start", "end", 2
                ]);
                expect(ws.hisRead.args[2]).to.eql([
                    ["id4"], "start", "end", 2
                ]);
            });
        })
    });

    describe("error handling", () => {
        it("should return encountered errors and arguments used", async () => {
            ws.hisRead = sinon.stub().callsFake(() => {
                throw new Error("Test error")
            });

            const result = await ws.batch.hisRead(["id1"], "start", "end");
            expect(result.errors.length).to.be.equal(1);
            const { error, args } = result.errors[0];
            expect(error).to.equal("Test error");
            expect(args).to.eql([["id1"], "start", "end", 100]);
        });
    });

    describe("2D transformation", () => {
        beforeEach(() => {
            ws.hisRead = sinon.stub().callsFake(() => {
                return HIS_READ_RESPONSE_SINGLE;
            });
        });

        describe("with 1 entity", () => {
            it("Should return a 2D array of hisRead data", async () => {
                const { success, errors } = await ws.batch.hisRead(
                    HIS_READ_RESPONSE_SINGLE_IDS,
                    new Date(0),
                    new Date()
                );
                expect(success.length).to.equal(1);
                const dataSet = success[0];
                for (let t = 0; t < dataSet.length; t++) {
                    expect(dataSet[t]).to.eql({
                        ts: `t:${(new Date(t)).toISOString()}`,
                        val: `n:${0}`
                    });
                }
            });
        });

        describe("with more than 1 entity", () => {
            beforeEach(() => {
                ws.hisRead = sinon.stub().callsFake(() => {
                    return HIS_READ_RESPONSE_MULTI;
                });
            });

            it("Should return a 2D array of hisRead data", async () => {
                const { success, errors } = await ws.batch.hisRead(
                    HIS_READ_RESPONSE_MULTI_IDS,
                    new Date(0),
                    new Date()
                );
                expect(success.length).to.equal(5);
                for (let i = 0; i < success.length; i++) {
                    const dataSet = success[i];
                    for (let t = 0; t < dataSet.length; t++) {
                        expect(dataSet[t]).to.eql({
                            ts: `t:${(new Date(t)).toISOString()}`,
                            val: `n:${i}`
                        });
                    }
                }
            });
        });
    });
});