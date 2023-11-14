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
const HisWritePayload = require("../../../../src/utils/hisWritePayload");

const SMALL_DATA_1000 = require("./files/hisWrite_smallBatch.json");
const LARGE_DATA_3000 = require("./files/hisWrite_largeBatch.json");
const DEFAULT_BATCH_SIZE = 2000;

describe("client.batch.hisWrite", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.hisWrite = sinon.stub();
    });

    describe("payload", () => {
        describe("instance of HisWritePayload", () => {
            it("should use payload attribute", async () => {
                const payload = new HisWritePayload();
                payload.add("abc", [{ts: "t:asad", val: "n:123"}]);
                await ws.batch.hisWrite(payload);
                expect(ws.hisWrite.calledOnce).to.be.true;
                expect(ws.hisWrite.args[0]).to.eql([payload.payload, DEFAULT_BATCH_SIZE]);
            });
        });

        describe("not instance of HisWritePayload", () => {
            it("should use as is", async () => {
                const payload = new HisWritePayload();
                payload.add("abc", [{ts: "t:asad", val: "n:123"}]);
                await ws.batch.hisWrite(payload.payload);
                expect(ws.hisWrite.calledOnce).to.be.true;
                expect(ws.hisWrite.args[0]).to.eql([payload.payload, DEFAULT_BATCH_SIZE]);
            });
        });

        it("should reject if not an Object", async () => {
            for (const arg of [1, "1", true, []]) {
                try {
                    await ws.batch.hisWrite(arg);
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal(
                        "parameter hisWriteData must be of type Object",
                        `Failed with argument ${arg}`
                    );
                }
            }
        });
    });

    describe("no options specified", () => {
        describe("payload smaller than default batch size of 2000", () => {
            it("should send 1 hisWrite request", async () => {
                const payload = new HisWritePayload();
                payload.payload = SMALL_DATA_1000;
                await ws.batch.hisWrite(payload);
                expect(ws.hisWrite.calledOnce).to.be.true;
                expect(ws.hisWrite.args[0][1]).to.eql(2000);
                for (const [key, values] of Object.entries(ws.hisWrite.args[0][0])) {
                    expect(SMALL_DATA_1000[key]).to.not.be.undefined;
                    expect(SMALL_DATA_1000[key]).to.eql(values);
                }
            });
        });

        describe("payload larger than default batch size of 2000", () => {
            it("should send multiple hisWrite requests", async () => {
                const payload = new HisWritePayload();
                payload.payload = LARGE_DATA_3000;
                await ws.batch.hisWrite(payload);
                expect(ws.hisWrite.callCount).to.equal(2);
                const keys = Object.keys(LARGE_DATA_3000);
                let nextIndex = 0;
                for (let i = 0; i < ws.hisWrite.callCount; i++) {
                    const [payload, hisWriteBatch] = ws.hisWrite.args[i];
                    expect(hisWriteBatch).to.equal(2000);
                    const subKeys = keys.slice(nextIndex, 200);
                    nextIndex += 200;
                    for (const key of subKeys) {
                        expect(payload[key]).to.not.be.undefined;
                        expect(payload[key]).to.eql(LARGE_DATA_3000[key]);
                    }
                }
            });
        });
    });

    describe("option batchSize", () => {
        describe("payload smaller than default batch size", () => {
            it("should send 1 hisWrite request", async () => {
                const payload = new HisWritePayload();
                payload.payload = SMALL_DATA_1000;
                await ws.batch.hisWrite(payload, {
                    batchSize: 1100
                });
                expect(ws.hisWrite.calledOnce).to.be.true;
                expect(ws.hisWrite.args[0][1]).to.eql(1100);
                for (const [key, values] of Object.entries(ws.hisWrite.args[0][0])) {
                    expect(SMALL_DATA_1000[key]).to.not.be.undefined;
                    expect(SMALL_DATA_1000[key]).to.eql(values);
                }
            });
        });

        describe("payload larger than default batch size", () => {
            it("should send multiple hisWrite requests", async () => {
                const payload = new HisWritePayload();
                payload.payload = SMALL_DATA_1000;
                await ws.batch.hisWrite(payload, {
                    batchSize: 200
                });
                expect(ws.hisWrite.callCount).to.equal(5);
                const keys = Object.keys(SMALL_DATA_1000);
                let nextIndex = 0;
                for (let i = 0; i < 5; i++) {
                    const [payload, hisWriteBatch] = ws.hisWrite.args[i];
                    expect(hisWriteBatch).to.equal(200);
                    const subKeys = keys.slice(nextIndex, 200);
                    nextIndex += 200;
                    for (const key of subKeys) {
                        expect(payload[key]).to.not.be.undefined;
                        expect(payload[key]).to.eql(SMALL_DATA_1000[key]);
                    }
                }
            });
        });
    });

    describe("option returnResult", () => {
        describe("if enabled", () => {
            it("should return response", async () => {
                const payload = new HisWritePayload();
                payload.payload = SMALL_DATA_1000;

                ws.hisWrite = sinon.stub().callsFake(() => {
                    return ["test"]
                });
                const result = await ws.batch.hisWrite(payload, {
                    returnResult: true
                });
                expect(result).to.eql({
                    success: [["test"]],
                    errors: []
                });
            });
        });

        describe("if disabled", () => {
            it("should not return response", async () => {
                const payload = new HisWritePayload();
                payload.payload = SMALL_DATA_1000;

                ws.hisWrite = sinon.stub().callsFake(() => {
                    return ["test"]
                });
                const result = await ws.batch.hisWrite(payload, {
                    returnResult: false
                });
                expect(result).to.eql({
                    success: [],
                    errors: []
                });
            });
        });
    });

    describe("error handling", () => {
        it("should return encountered errors and arguments used", async () => {
            const payload = new HisWritePayload();
            payload.payload = SMALL_DATA_1000;

            ws.hisWrite = sinon.stub().callsFake(() => {
                throw new Error("Test error")
            });


            const result = await ws.batch.hisWrite(payload);
            expect(result.errors.length).to.be.equal(1);
            const { error, args } = result.errors[0];
            expect(error).to.equal("Test error");
            expect(args).to.eql([SMALL_DATA_1000, 2000]);
        });
    })
});