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
                payload.add("r:abc", [{ts: "t:asad", val: "n:123"}]);
                await ws.batch.hisWrite(payload);
                expect(ws.hisWrite.calledOnce).to.be.true;
                expect(ws.hisWrite.args[0]).to.eql([payload.payload]);
            });
        });

        describe("not instance of HisWritePayload", () => {
            it("should use as is", async () => {
                const payload = new HisWritePayload();
                payload.add("r:abc", [{ts: "t:asad", val: "n:123"}]);
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
                // Raise the entity cap above the fixture's 834 entities so this
                // test exercises row-based chunking only.
                await ws.batch.hisWrite(payload, { batchSizeEntity: 1000 });
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
                // Raise the entity cap above the fixture's 1000 entities so this
                // test continues to exercise row-based chunking only.
                await ws.batch.hisWrite(payload, { batchSizeEntity: 1000 });

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
                // Raise the entity cap above the fixture's 834 entities so this
                // test exercises row-based chunking only.
                await ws.batch.hisWrite(payload, { batchSize, batchSizeEntity: 1000 });
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
                // Raise the entity cap above the fixture's 834 entities so this
                // test exercises returnResult behavior only.
                const result = await ws.batch.hisWrite(payload, {
                    returnResult: true,
                    batchSizeEntity: 1000
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

            // Raise the entity cap above the fixture's 834 entities so this
            // test exercises error-handling behavior with a single batch only.
            const result = await ws.batch.hisWrite(payload, { batchSizeEntity: 1000 });
            expect(result.errors.length).to.be.equal(1);
            const { error, args } = result.errors[0];
            expect(error).to.equal("Test error");
            expect(args).to.eql(["hisWrite", SMALL_DATA_1000]);
        });
    });

    describe("option batchSizeEntity", () => {
        /**
         * Build a payload of `entityCount` entities, each with `rowsPerEntity` rows.
         * Timestamps and values are deterministic (entity index + row index) and
         * unique across entities so the test can assert exact membership.
         */
        function buildPayload(entityCount, rowsPerEntity) {
            const payload = {};
            for (let e = 0; e < entityCount; e++) {
                const key = `r:e${e}`;
                payload[key] = {};
                for (let r = 0; r < rowsPerEntity; r++) {
                    payload[key][`t:e${e}r${r}`] = `n:${e * 1000 + r}`;
                }
            }
            return payload;
        }

        describe("when entity cap is binding (many small entities)", () => {
            it("should chunk by entity count", async () => {
                const payload = buildPayload(250, 1);   // 250 entities × 1 row
                await ws.batch.hisWrite(payload);       // defaults: rows=10000, entities=100
                expect(ws.hisWrite.callCount).to.equal(3);
                const sizes = ws.hisWrite.args.map(
                    (callArgs) => Object.keys(callArgs[0]).length
                );
                expect(sizes).to.eql([100, 100, 50]);
            });
        });

        describe("when row cap is binding (one fat entity)", () => {
            it("should split a single fat entity by row count", async () => {
                const payload = buildPayload(1, 25000); // 1 entity × 25000 rows
                await ws.batch.hisWrite(payload, {
                    batchSize: 10000,
                    batchSizeEntity: 100
                });
                expect(ws.hisWrite.callCount).to.equal(3);
                const rowsPerCall = ws.hisWrite.args.map(
                    (callArgs) => HisWritePayload.calculateSize(callArgs[0])
                );
                expect(rowsPerCall).to.eql([10000, 10000, 5000]);
                // The single entity key appears in every call.
                for (const callArgs of ws.hisWrite.args) {
                    expect(Object.keys(callArgs[0])).to.eql(["r:e0"]);
                }
            });
        });

        describe("when both caps interact", () => {
            it("should not exceed either cap in any batch", async () => {
                // 50 entities × 500 rows each = 25000 rows total
                const payload = buildPayload(50, 500);
                await ws.batch.hisWrite(payload, {
                    batchSize: 10000,
                    batchSizeEntity: 100
                });
                for (const callArgs of ws.hisWrite.args) {
                    const batch = callArgs[0];
                    expect(Object.keys(batch).length).to.be.at.most(100);
                    expect(HisWritePayload.calculateSize(batch)).to.be.at.most(10000);
                }
                // Sanity: total rows preserved across batches.
                const totalRows = ws.hisWrite.args.reduce(
                    (sum, callArgs) => sum + HisWritePayload.calculateSize(callArgs[0]),
                    0
                );
                expect(totalRows).to.equal(25000);
            });
        });

        describe("client-level default", () => {
            it("should honour clientOptions.batch.hisWrite.batchSizeEntity", async () => {
                ws = getInstance(http, log, {
                    clientOptions: {
                        batch: {
                            hisWrite: { batchSizeEntity: 25 }
                        }
                    }
                });
                ws.hisWrite = sinon.stub();
                const payload = buildPayload(60, 1); // 60 entities × 1 row
                await ws.batch.hisWrite(payload);    // no call-site option

                expect(ws.hisWrite.callCount).to.equal(3);
                const sizes = ws.hisWrite.args.map(
                    (callArgs) => Object.keys(callArgs[0]).length
                );
                expect(sizes).to.eql([25, 25, 10]);
            });
        });

        describe("validation", () => {
            const bads = [
                { value: 0,        why: "below min" },
                { value: 1001,     why: "above max" },
                { value: "100",    why: "not a number (string)" },
                { value: -1,       why: "negative" }
            ];

            for (const { value, why } of bads) {
                it(`should reject batchSizeEntity=${JSON.stringify(value)} (${why})`, async () => {
                    const payload = buildPayload(5, 1);
                    let threw = false;
                    try {
                        await ws.batch.hisWrite(payload, { batchSizeEntity: value });
                    } catch (err) {
                        threw = true;
                    }
                    expect(threw, `expected to throw for ${why}`).to.be.true;
                    expect(ws.hisWrite.called).to.be.false;
                });
            }

            it("should tolerate unknown per-call option keys", async () => {
                // Unknown keys are only rejected on the options.client
                // construction path (CORE-9107); per-call options keep the
                // historical pass-through behaviour.
                const payload = buildPayload(5, 1);
                await ws.batch.hisWrite(payload, { someUnknownKey: 1 });
                expect(ws.hisWrite.called).to.be.true;
            });
        });
    });
});