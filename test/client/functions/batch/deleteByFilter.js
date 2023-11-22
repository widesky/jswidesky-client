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

const DELETE_BATCH_SIZE = 30;

function genEntities(num) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        entities.push({
            id: `r:${i}`,
            name: `s:${i}-entity`,
            dis: `s:Entity ${i}`,
            site: "m:"
        });
    }

    return entities;
}

describe("client.batch.deleteByFilter", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.v2.find = sinon.stub().callsFake(() => []);
        ws.deleteById = sinon.stub().callsFake((entities) =>  {
            return {
                rows: entities
            };
        });
    });

    describe("options not specified", () => {
        describe("entity payload smaller than default batchSize", () => {
            it("should deleteById 1 request", async () => {
                const entities = genEntities(DELETE_BATCH_SIZE - 4)
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.deleteByFilter("point");
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.deleteById.calledOnce).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([
                    entities.map((entity) => Hs.getId(entity))
                ]);
            });
        });

        describe("entity payload larger than default batchSize", () => {
            it("should deleteById more than 1 request", async () => {
                const entities = genEntities(DELETE_BATCH_SIZE + 10)
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.deleteByFilter("point");
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.deleteById.calledTwice).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([
                    entities
                        .slice(0, DELETE_BATCH_SIZE)
                        .map((entity) => Hs.getId(entity))
                ]);
                expect(ws.deleteById.args[1]).to.eql([
                    entities
                        .slice(DELETE_BATCH_SIZE)
                        .map((entity) => Hs.getId(entity))
                ]);
            });
        });
    });

    describe("option batchSize", () => {
        describe("entity payload smaller than batchSize", () => {
            it("should deleteById 1 request", async () => {
                const entities = genEntities(10)
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.deleteByFilter("point", 0, {
                    batchSize: 11
                });
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.deleteById.calledOnce).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([
                    entities.map((entity) => Hs.getId(entity))
                ]);
            });
        });

        describe("entity payload larger than batchSize", () => {
            it("should deleteById more than 1 request", async () => {
                const entities = genEntities(10)
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.deleteByFilter("point", 0, {
                    batchSize: 6
                });
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.deleteById.calledTwice).to.be.true;
                expect(ws.deleteById.args[0]).to.eql([
                    entities
                        .slice(0, 6)
                        .map((entity) => Hs.getId(entity))
                ]);
                expect(ws.deleteById.args[1]).to.eql([
                    entities
                        .slice(6)
                        .map((entity) => Hs.getId(entity))
                ]);
            });
        });
    });

    describe("option returnResult", () => {
        describe("enabled", () => {
            it("should return result", async () => {
                const entities = genEntities(2);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                const { success, errors} = await ws.batch.deleteByFilter("point", 0, {
                    returnResult: true
                });
                expect(success).to.eql([{
                    rows: entities.map((entity) => Hs.getId(entity))
                }]);
                expect(errors.length).to.equal(0);
            });
        });

        describe("disabled", () => {
            it("should not return result", async () => {
                const entities = genEntities(2);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                const { success, errors} = await ws.batch.deleteByFilter("point", 0, {
                    returnResult: false
                });
                expect(success.length).to.equal(0);
                expect(errors.length).to.equal(0);
            });
        });
    });

    describe("error handling", () => {
        it("should handle errors encountered by v2.filter and return them", async () => {
            ws.v2.find = sinon.stub().callsFake(() => {
                throw new Error("Bad filter");
            });

            const { success, errors } = await ws.batch.deleteByFilter("bad filter");
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Bad filter",
                args: ["v2.find", "bad filter", 0]
            });
        });

        it("should handle errors encountered by deleteById and return them", async () => {
            const entities = genEntities(2);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            ws.deleteById = sinon.stub().callsFake(() => {
                throw new Error("Not well");
            });

            const { success, errors } = await ws.batch.deleteByFilter("bad filter");
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Not well",
                args: [
                    "deleteById",
                    entities
                        .map((entity) => Hs.getId(entity))
                ]
            });
        });
    });
});