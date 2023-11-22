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
const EntityCriteria = require("../../../../src/utils/EntityCriteria");

const UPDATE_BATCH_SIZE = 2000;
const TEST_CRITERIA = new EntityCriteria(
    "test",
    (entity) => entity.site !== undefined,
    (entity, oldEntity) => {
        entity.test = "123";
    }
);

function genEntities(num, extraTagValues=[]) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        const entity = {
            id: `r:${i}`,
            name: `s:${i}-entity`,
            dis: `s:Entity ${i}`,
            site: "m:"
        };
        if (extraTagValues[i] !== undefined && extraTagValues[i][0] !== undefined) {
            const [tag, value] = extraTagValues[i];
            entity[tag] = value;
        }

        entities.push(entity);
    }

    return entities;
}

describe("client.batch.updateByFilter", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.v2.find = sinon.stub().callsFake(() => []);
        ws.update = sinon.stub().callsFake((entities) =>  {
            return {
                rows: entities
            };
        });
    });

    describe("parameter criteriaList", () => {
        it("should only update those that are valid", async () => {
            const entities = genEntities(4, [
                ["test", "123"],
                [],
                ["test", "123"],
                ["test", "123"]
            ]);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            const criteria = new EntityCriteria(
                "test",
                (entity) => entity.test !== undefined,
                (entity, oldEntity) => {
                    entity.added = "890";
                }
            );
            await ws.batch.updateByFilter("point", [criteria]);
            const eIds = entities.map((entity) => entity.id);
            expect(ws.update.calledOnce).to.be.true;
            expect(ws.update.args[0]).to.eql([[
                {
                    id: eIds[0],
                    added: "890"
                },
                {
                    id: eIds[2],
                    added: "890"
                },
                {
                    id: eIds[3],
                    added: "890"
                }
            ]]);
        });

        it("should reject if any criteria is not an instance of EntityCriteria", async () => {
            const entities = genEntities(4);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            const criteria = {}
            try {
                await ws.batch.updateByFilter("point", [criteria]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Not class EntityCriteria");
            }
        });
    })

    describe("options not specified", () => {
        describe("entity payload smaller than default batchSize", () => {
            it("should create 1 request", async () => {
                const entities = genEntities(UPDATE_BATCH_SIZE - 10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.updateByFilter("point", [TEST_CRITERIA]);
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.update.calledOnce).to.be.true;
                expect(ws.update.args[0]).to.eql([
                    entities.map((entity) => {
                        return {
                            id: entity.id,
                            test: "123"
                        };
                    })
                ]);
            });
        });

        describe("entity payload larger than default batchSize", () => {
            it("should create more than 1 request", async () => {
                const entities = genEntities(UPDATE_BATCH_SIZE + 10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.updateByFilter("point", [TEST_CRITERIA]);
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.update.calledTwice).to.be.true;
                expect(ws.update.args[0]).to.eql([
                    entities.slice(0, UPDATE_BATCH_SIZE).map((entity) => {
                        return {
                            id: entity.id,
                            test: "123"
                        };
                    })
                ]);
                expect(ws.update.args[1]).to.eql([
                    entities.slice(UPDATE_BATCH_SIZE).map((entity) => {
                        return {
                            id: entity.id,
                            test: "123"
                        };
                    })
                ]);
            });
        });
    });

    describe("option batchSize", () => {
        describe("entity payload smaller than batchSize", () => {
            it("should create 1 request", async () => {
                const entities = genEntities(10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.updateByFilter("point", [TEST_CRITERIA], {
                    batchSize: 10
                });
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.update.calledOnce).to.be.true;
                expect(ws.update.args[0]).to.eql([
                    entities.map((entity) => {
                        return {
                            id: entity.id,
                            test: "123"
                        };
                    })
                ]);
            });
        });

        describe("entity payload larger than batchSize", () => {
            it("should create more than 1 request", async () => {
                const entities = genEntities(10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                await ws.batch.updateByFilter("point", [TEST_CRITERIA], {
                    batchSize: 5
                });
                expect(ws.v2.find.calledOnce).to.be.true;
                expect(ws.update.calledTwice).to.be.true;
                expect(ws.update.args[0]).to.eql([
                    entities.slice(0, 5).map((entity) => {
                        return {
                            id: entity.id,
                            test: "123"
                        };
                    })
                ]);
                expect(ws.update.args[1]).to.eql([
                    entities.slice(5).map((entity) => {
                        return {
                            id: entity.id,
                            test: "123"
                        };
                    })
                ]);
            });
        });
    });

    describe("option limit", () => {
        it("should pass limit to client.v2.find", async () => {
            const entities = genEntities(1);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            await ws.batch.updateByFilter("point", [TEST_CRITERIA], {
                limit: 5
            });
            expect(ws.v2.find.calledOnce).to.be.true;
            expect(ws.v2.find.args[0]).to.eql(["point", 5]);
        });
    });

    describe("option returnResult", () => {
        describe("enabled", () => {
            it("should return result", async () => {
                const entities = genEntities(10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                const { success, errors } = await ws.batch.updateByFilter("point", [TEST_CRITERIA], {
                    returnResult: true
                });
                expect(success.length).to.equal(ws.update.callCount);
                expect(success).to.eql([
                        {
                            rows: entities
                                .map((entity) => {
                                    return {
                                        id: entity.id,
                                        test: "123"
                                    }
                                })
                        }
                ]);
                expect(errors.length).to.equal(0);
            });
        });

        describe("disabled", () => {
            it("should not return result", async () => {
                const entities = genEntities(10);
                ws.v2.find = sinon.stub().callsFake(() => entities);
                const { success, errors } = await ws.batch.updateByFilter("point", [TEST_CRITERIA], {
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

            const { success, errors } = await ws.batch.updateByFilter("bad filter", [TEST_CRITERIA]);
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Bad filter",
                args: ["v2.find", "bad filter", 0]
            });
        });

        it("should handle errors encountered by hisRead and return them", async () => {
            const entities = genEntities(2);
            ws.v2.find = sinon.stub().callsFake(() => entities);
            ws.update = sinon.stub().callsFake(() => {
                throw new Error("Not well");
            });

            const { success, errors } = await ws.batch.updateByFilter("bad filter", [TEST_CRITERIA]);
            expect(success.length).to.equal(0);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.eql({
                error: "Not well",
                args: [
                    "update",
                    entities
                        .map((entity) => {
                            return {
                                id: entity.id,
                                test: "123"
                            }
                        })
                ]
            });
        });
    });
});