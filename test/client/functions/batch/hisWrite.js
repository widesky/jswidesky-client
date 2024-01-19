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

// Structured as 10 entities for 834 different timestamps
const SMALL_DATA_1000 = require("./files/hisWrite_smallBatch.json");
// Structured as 1000 entities for 30 different timestamps
const LARGE_DATA_20000 = require("./files/hisWrite_largeBatch.json");
const DEFAULT_BATCH_SIZE = 10000;

/**
 * Construct the expected batched payloads.
 * Note: This feels silly to nearly copy the logic used. But this is not something I wanna do manually.
 * @param payload Payload to be batched.
 * @param batchSize Size of each batch.
 * @returns {*[]} An Array of each batched payload.
 */
function constructPayloadBatches(payload, batchSize) {
    const batches = [];
    let index = 0;
    const entries = [];
    for (const [key, values] of Object.entries(payload)) {
        entries.push([key, Object.entries(values)]);
    }
    let currBatch = {};
    let rowsAdded = 0;
    while (index < entries.length) {
        if (rowsAdded === batchSize) {
            batches.push(currBatch);
            currBatch = {};
            rowsAdded = 0;
        }

        const [key, values] = entries[index];
        if (currBatch[key] === undefined) {
            currBatch[key] = {};
        }

        while (Object.keys(currBatch[key]).length < batchSize && entries[index][1].length > 0) {
            const next = entries[index][1].splice(0, batchSize);
            for (const [nKey, nValues] of next) {
                currBatch[key][nKey] = nValues;
            }
            rowsAdded += next.length;
        }

        if (entries[index][1].length === 0) {
            index++;
        }
    }

    if (Object.entries(currBatch).length > 0) {
        batches.push(currBatch);
    }

    return batches;
}

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
                expect(ws.hisWrite.args[0]).to.eql([payload.payload]);
            });
        });

        describe("not instance of HisWritePayload", () => {
            it("should use as is", async () => {
                const payload = new HisWritePayload();
                payload.add("abc", [{ts: "t:asad", val: "n:123"}]);
                await ws.batch.hisWrite(payload.payload);
                expect(ws.hisWrite.calledOnce).to.be.true;
                expect(ws.hisWrite.args[0]).to.eql([payload.payload]);
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
        describe("payload smaller than default batch size of 10000", () => {
            it("should send 1 hisWrite request", async () => {
                const payload = new HisWritePayload(SMALL_DATA_1000);
                await ws.batch.hisWrite(payload);
                expect(ws.hisWrite.calledOnce).to.be.true;
                for (const [key, values] of Object.entries(ws.hisWrite.args[0][0])) {
                    expect(SMALL_DATA_1000[key]).to.not.be.undefined;
                    expect(SMALL_DATA_1000[key]).to.eql(values);
                }
            });
        });

        describe("payload larger than default batch size of 10000", () => {
            it("should send multiple hisWrite requests", async () => {
                const payload = new HisWritePayload(LARGE_DATA_20000);
                await ws.batch.hisWrite(payload);

                expect(ws.hisWrite.callCount).to.equal(3);
                const expectedBatches = constructPayloadBatches(LARGE_DATA_20000, DEFAULT_BATCH_SIZE);
                expect(expectedBatches.length).to.equal(ws.hisWrite.callCount);
                for (let i = 0; i < ws.hisWrite.callCount; i++) {
                    const payload = ws.hisWrite.args[i][0];
                    expect(HisWritePayload.calculateSize(payload)).to.equal(DEFAULT_BATCH_SIZE);
                    expect(payload).to.eql(expectedBatches[i]);
                }
            });
        });
    });

    describe("option batchSize", () => {
        describe("payload smaller than default batch size", () => {
            it("should send 1 hisWrite request", async () => {
                const payload = new HisWritePayload(SMALL_DATA_1000);
                const batchSize = 20000;
                await ws.batch.hisWrite(payload, { batchSize });
                expect(ws.hisWrite.calledOnce).to.be.true;
                for (const [key, values] of Object.entries(ws.hisWrite.args[0][0])) {
                    expect(SMALL_DATA_1000[key]).to.not.be.undefined;
                    expect(SMALL_DATA_1000[key]).to.eql(values);
                }
            });
        });

        describe("payload larger than default batch size", () => {
            it("should send multiple hisWrite requests", async () => {
                const payload = new HisWritePayload(SMALL_DATA_1000);
                const batchSize = 200;
                await ws.batch.hisWrite(payload, { batchSize });
                expect(ws.hisWrite.callCount).to.equal(42);
                const expectedBatches = constructPayloadBatches(SMALL_DATA_1000, batchSize);
                expect(expectedBatches.length).to.equal(ws.hisWrite.callCount);
                for (let i = 0; i < ws.hisWrite.callCount; i++) {
                    const payload = ws.hisWrite.args[i][0];
                    expect(HisWritePayload.calculateSize(payload)).to.be.lessThanOrEqual(batchSize);
                    expect(payload).to.eql(expectedBatches[i]);
                }
            });
        });
    });

    describe("option returnResult", () => {
        describe("if enabled", () => {
            it("should return response", async () => {
                const payload = new HisWritePayload(SMALL_DATA_1000);

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
                const payload = new HisWritePayload(SMALL_DATA_1000);

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
            const payload = new HisWritePayload(SMALL_DATA_1000);

            ws.hisWrite = sinon.stub().callsFake(() => {
                throw new Error("Test error")
            });


            const result = await ws.batch.hisWrite(payload);
            expect(result.errors.length).to.be.equal(1);
            const { error, args } = result.errors[0];
            expect(error).to.equal("Test error");
            expect(args).to.eql(["hisWrite", SMALL_DATA_1000]);
        });
    });
});