/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../../stubs');
const sinon = require('sinon');
const HisWritePayload = require("../../../../src/utils/hisWritePayload");
const SMALL_DATA_1000 = require("./files/hisWrite_smallBatch.json");
const expect = require('chai').expect;
const getInstance = stubs.getInstance;

const HIS_READ_BATCH_SIZE = 100;

describe("client.batch.hisRead", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.hisRead = sinon.stub();
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
            ws.hisRead = sinon.stub().callsFake(() =>  "abc");
            const result = await ws.batch.hisRead(["id1"], "start", "end");
            expect(result).to.eql({
                success: ["abc"],
                errors: []
            });
        });
    });

    describe("option batchSize", async () => {
        describe("payload smaller than batchSize", () => {
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

    describe("option returnResult", () => {
        beforeEach(() => {
            ws.hisRead = sinon.stub().callsFake(() =>  "abc");
        });

        describe("if enabled", () => {
            it("should return result", async () => {
                const result = await ws.batch.hisRead(["id1"], "start", "end", {
                    returnResult: true
                });
                expect(result).to.eql({
                    success: ["abc"],
                    errors: []
                });
            });
        });

        describe("if disabled", () => {
            it("should not return result", async () => {
                const result = await ws.batch.hisRead(["id1"], "start", "end", {
                    returnResult: false
                });
                expect(result).to.eql({
                    success: [],
                    errors: []
                });
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
    })
});