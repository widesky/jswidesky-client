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

const CREATE_BATCH_SIZE = 2000;

describe("client.batch.create", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.create = sinon.stub().callsFake((entities) =>  {
            return {
                rows: entities
            };
        });
    });

    describe("options not specified", () => {
        describe("entity payload smaller than default batchSize", () => {
            it("should create 1 request", async () => {
                const entities = genEntities(10);
                await ws.batch.create(entities);
                expect(ws.create.calledOnce).to.be.true;
                expect(ws.create.args[0]).to.eql([entities]);
            });
        });

        describe("entity payload larger than default batchSize", () => {
            it("should create more than 1 request", async () => {
                const entities = genEntities(CREATE_BATCH_SIZE + 10);
                await ws.batch.create(entities);
                expect(ws.create.calledTwice).to.be.true;
                expect(ws.create.args[0]).to.eql([entities.slice(0, CREATE_BATCH_SIZE)]);
                expect(ws.create.args[1]).to.eql([entities.slice(CREATE_BATCH_SIZE)]);
            });
        });
    });

    describe("option batchSize", () => {
        describe("entity payload smaller than batchSize", () => {
            it("should create 1 request", async () => {
                const entities = genEntities(10);
                await ws.batch.create(entities, {
                    batchSize: 11
                });
                expect(ws.create.calledOnce).to.be.true;
                expect(ws.create.args[0]).to.eql([entities]);
            });
        });

        describe("entity payload larger than batchSize", () => {
            it("should create more than 1 request", async () => {
                const entities = genEntities(10);
                await ws.batch.create(entities, {
                    batchSize: 5
                });
                expect(ws.create.calledTwice).to.be.true;
                expect(ws.create.args[0]).to.eql([entities.slice(0, 5)]);
                expect(ws.create.args[1]).to.eql([entities.slice(5)]);
            });
        });
    });

    describe("option returnResult", () => {
        describe("enabled", () => {
            it("should return result", async () => {
                const entities = genEntities(2);
                const { success, errors} = await ws.batch.create(entities, {
                    returnResult: true
                });
                expect(success).to.eql([{rows: entities}]);
                expect(errors.length).to.equal(0);
            });
        });

        describe("disabled", () => {
            it("should not return result", async () => {
                const entities = genEntities(2);
                const { success, errors} = await ws.batch.create(entities, {
                    returnResult: false
                });
                expect(success.length).to.equal(0);
                expect(errors.length).to.equal(0);
            });
        });
    });

    describe("error handling", () => {
        it("should handle errors encountered and return them", async () => {
            ws.create = sinon.stub().callsFake(() => {
                throw new Error("Test Error");
            });
            const entities = genEntities(2);
            const { success, errors} = await ws.batch.create(entities, {
                returnResult: true
            });
            expect(success.length).to.equal(0);
            expect(errors).to.eql([
                {
                    error: "Test Error",
                    args: [entities]
                }
            ]);
        });
    });
});