"use strict";

const stubs = require('../../../stubs');
const sinon = require('sinon');
const expect = require('chai').expect;
const getInstance = stubs.getInstance;

const HIS_DELETE_ENTITY_BATCH_SIZE = 100;
const HIS_READ_LARGE = require("./files/hisRead_large.json");
const HIS_READ_LARGE_IDS = [
    '01912a1b-65fd-4449-b4e9-e8dc48e3b148',
    '06037f10-bc06-4ddd-a58e-3fe2a975e830',
    '0824d6c3-ebde-420d-96a4-272afe842190',
    '0bf95511-ec6c-4990-8555-b98ef44ec22b',
    '0c1f66e3-7666-4cb6-8f7a-62b48101cc64'
];

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
        describe("time range batching", () => {
            it("should create batches of hisDelete ranges", async () => {
                ws.batch.hisRead = sinon.stub().callsFake(() => HIS_READ_LARGE);
                await ws.batch.hisDelete(HIS_READ_LARGE_IDS, "1990-01-01T00:00:00Z,2023-10-10T00:00:00Z");
                console.log
            })
        });

        describe("no options specified", () => {
            describe("payload smaller than default batch size of 100", () => {
                it("should only make 1 request", async () => {

                });
            });

            describe("payload greater than default batch size of 100", () => {
                it("should make more than 1 request", async () => {

                });
            });
        });

        describe("option batchSize", () => {
        });

        describe("option returnResult", () => {
            describe("if enabled", () => {
                it("should return the result", async () => {

                });
            });

            describe("if not enabled", () => {
                it("should not return the result", async () => {

                });
            });
        });
    });
});