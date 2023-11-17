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

const TEST_SITE_REF = "d91d0892-15ac-4027-aaf3-25b042a8b200";

function genParents(num) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        entities.push({
            id: `r:${i}`,
            name: `s:${i}-entity-parent`,
            dis: `s:Entity ${i}`,
            equip: "m:",
            siteRef: `r:${TEST_SITE_REF}`
        });
    }

    return entities;
}

function genChildren(num) {
    const entities = [];
    for (let i = 0; i < num; i++) {
        entities.push({
            id: `r:${i}`,
            name: `s:${i}-entity-child`,
            dis: `s:Entity ${i}`,
            point: "m:"
        });
    }

    return entities;
}

const CREATE_BATCH_SIZE = 2000;

describe("client.batch.addChildrenByFilter", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.v2.find = sinon.stub().callsFake(() => []);
        ws.create = sinon.stub().callsFake((entities) => {
            return {
                rows: entities
            };
        });
    });

    describe("parameter filter", () => {
        it("should pass filter to v2.find", async () => {
            await ws.batch.addChildrenByFilter("equip", [genChildren(1)], [["id", "equipRef"]]);
            expect(ws.v2.find.calledOnce).to.be.true;
            expect(ws.v2.find.args[0]).to.eql(["equip", 0]);
        });
    });

    describe("parameter children", () => {
        it("should reject if not array", async () => {
            try {
                await ws.batch.addChildrenByFilter("equip", 1, [["id", "equipRef"]]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("parameter children is not an Array of Objects");
            }
        });

        it("should reject if not an array of Objects", async () => {
            try {
                await ws.batch.addChildrenByFilter("equip", [...genChildren(1), 1], [["id", "equipRef"]]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("parameter children is not an Array of Objects");
            }
        })
    })

    describe("parameter refTags", () => {
        it("should reject if not 2D array", async () => {
            try {
                await ws.batch.addChildrenByFilter("equip", [genChildren(1)], 1);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("parameter refTags is not a 2D Array as specified");
            }
        });
    });

    describe("option.limit", () => {
        it("should pass default limit to v2.find", async () => {
            await ws.batch.addChildrenByFilter("equip", genChildren(1), [["id", "equipRef"]]);
            expect(ws.v2.find.calledOnce).to.be.true;
            expect(ws.v2.find.args[0]).to.eql(["equip", 0]);
        });

        it("should pass limit to v2.find if specified", async () => {
            await ws.batch.addChildrenByFilter("equip", genChildren(1), [["id", "equipRef"]], {
                limit: 123
            });
            expect(ws.v2.find.calledOnce).to.be.true;
            expect(ws.v2.find.args[0]).to.eql(["equip", 123]);
        });
    });

    describe("option.returnResult", () => {
        describe("enabled", () => {
            it("should return result", () => {

            });
        });

        describe("disabled", () => {
            it("should not return result", () => {

            });
        });
    });

    describe("single parent 1 child", () => {
        let parents;
        beforeEach(() => {
            ws.v2.find = sinon.stub().callsFake(() => genParents(1));
        });

        it("should assign ref tags from parent to child", async () => {
            const children = genChildren(1);
            const refTags = [["siteRef", "siteRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            expect(ws.create.args[0][0]).to.eql(
                children.map((child) => {
                    child.siteRef = `r:${TEST_SITE_REF}`;
                    return child;
                })
            );
        });

        it("should not assign ref tags if not present on parent", async () => {
            const children = genChildren(1);
            const refTags = [["equipRef", "equipRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.notCalled).to.be.true;
        });
    });

    describe("single parent many children", () => {
        let parents;
        beforeEach(() => {
            ws.v2.find = sinon.stub().callsFake(() => genParents(1));
        });

        it("should assign ref tags from parent to child", async () => {
            const children = genChildren(5);
            const refTags = [["siteRef", "siteRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            expect(ws.create.args[0]).to.eql([
                children.map((child) => {
                    child.siteRef = `r:${TEST_SITE_REF}`;
                    return child;
                })
            ]);
        });

        it("should not assign ref tags if not present on parent", async () => {
            const children = genChildren(5);
            const refTags = [["siteRef", "siteRef"], ["panelRef", "panelRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            expect(ws.create.args[0]).to.eql([
                children.map((child) => {
                    child.siteRef = `r:${TEST_SITE_REF}`;
                    return child;
                })
            ]);
        });

        it("should not call create if no ref tags were assigned to the children", async () => {
            const children = genChildren(5);
            const refTags = [["equipRef", "equipRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.notCalled).to.be.true;
        });
    });

    describe("many parents and 1 child", () => {
        let parents;
        beforeEach(() => {
            ws.v2.find = sinon.stub().callsFake(() => genParents(5));
        });

        it("should assign ref tags from parent to child", async () => {
            const children = genChildren(1);
            const refTags = [["siteRef", "siteRef"], ["name", "whichParent"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            const expectedChildren = [
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:3-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:4-entity-parent"
                }
            ];
            expect(ws.create.args[0][0]).to.eql(expectedChildren);
        });

        it("should not assign ref tags if not present on parent", async () => {
            const children = genChildren(1);
            const refTags = [["siteRef", "siteRef"], ["name", "whichParent"], ["panelRef", "panelRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            const expectedChildren = [
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:3-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:4-entity-parent"
                }
            ];
            expect(ws.create.args[0][0]).to.eql(expectedChildren);
        });

        it("should not call create if no ref tags were assigned to the children", async () => {
            const children = genChildren(1);
            const refTags = [["equipRef", "equipRef"], ["namee", "whichParent"], ["panelRef", "panelRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.notCalled).to.be.true;
        });
    });

    describe("many parents and many children", () => {
        let parents;
        beforeEach(() => {
            ws.v2.find = sinon.stub().callsFake(() => genParents(3));
        });

        it("should assign ref tags from parent to child", async () => {
            const children = genChildren(3);
            const refTags = [["siteRef", "siteRef"], ["name", "whichParent"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            const expectedChildren = [
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:1`,
                    name: `s:1-entity-child`,
                    dis: `s:Entity 1`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:2`,
                    name: `s:2-entity-child`,
                    dis: `s:Entity 2`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:1`,
                    name: `s:1-entity-child`,
                    dis: `s:Entity 1`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:2`,
                    name: `s:2-entity-child`,
                    dis: `s:Entity 2`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                },
                {
                    id: `r:1`,
                    name: `s:1-entity-child`,
                    dis: `s:Entity 1`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                },
                {
                    id: `r:2`,
                    name: `s:2-entity-child`,
                    dis: `s:Entity 2`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                }
            ];
            expect(ws.create.args[0][0]).to.eql(expectedChildren);
        });

        it("should not assign ref tags if not present on parent", async () => {
            const children = genChildren(3);
            const refTags = [["siteRef", "siteRef"], ["name", "whichParent"], ["panelRef", "panelRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.calledOnce).to.be.true;
            const expectedChildren = [
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:1`,
                    name: `s:1-entity-child`,
                    dis: `s:Entity 1`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:2`,
                    name: `s:2-entity-child`,
                    dis: `s:Entity 2`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:0-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:1`,
                    name: `s:1-entity-child`,
                    dis: `s:Entity 1`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:2`,
                    name: `s:2-entity-child`,
                    dis: `s:Entity 2`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:1-entity-parent"
                },
                {
                    id: `r:0`,
                    name: `s:0-entity-child`,
                    dis: `s:Entity 0`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                },
                {
                    id: `r:1`,
                    name: `s:1-entity-child`,
                    dis: `s:Entity 1`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                },
                {
                    id: `r:2`,
                    name: `s:2-entity-child`,
                    dis: `s:Entity 2`,
                    point: "m:",
                    siteRef: `r:${TEST_SITE_REF}`,
                    whichParent: "s:2-entity-parent"
                }
            ];
            expect(ws.create.args[0][0]).to.eql(expectedChildren);
        });

        it("should not call create if no ref tags were assigned to the children", async () => {
            const children = genChildren(3);
            const refTags = [["equipRef", "equipRef"], ["namee", "whichParent"], ["panelRef", "panelRef"]];
            await ws.batch.addChildrenByFilter("equip", children, refTags);
            expect(ws.create.notCalled).to.be.true;
        });
    });
});