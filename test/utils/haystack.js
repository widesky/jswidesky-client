const {
    removePrefix,
    getId,
    getReadableName
} = require("../../src/utils/haystack");
const { expect } = require("chai");
const {getImportSource} = require("@babel/preset-env/lib/polyfills/utils");

const TEST_ENTITY_1 = 		{
    "id": "r:fbf64a12-b706-11ec-a271-0242ac120002 Apt 0603 Meter",
    "dis": "s:Apt 0603 Meter",
    "fqname": "s:300george.apt0603mtr",
    "siteRef": "r:9a283e08-b706-11ec-8a23-0242ac120002 300 George The One",
    "spaceRef": "r:a605ccf4-b706-11ec-93c4-0242ac120002 Apt 0603",
    "panelRef": "r:a605ccf4-b706-11ec-93c4-0242ac120003"
};
const TEST_ENTITY_2 = 		{
    "id": "r:fbf64a12-b706-11ec-a271-0242ac120003",
    "dis": "s:Apt 0603 Meter",
    "siteRef": "r:9a283e08-b706-11ec-8a23-0242ac120002 300 George The One",
    "spaceRef": "r:a605ccf4-b706-11ec-93c4-0242ac120002 Apt 0603",
    "panelRef": "r:a605ccf4-b706-11ec-93c4-0242ac120003",
    "jaffa": "affaj"
};
const TEST_ENTITY_NO_ID = {
    "dis": "s:Apt 0603 Meter",
    "fqname": "s:300george.apt0603mtr",
    "siteRef": "r:9a283e08-b706-11ec-8a23-0242ac120002 300 George The One",
    "spaceRef": "r:a605ccf4-b706-11ec-93c4-0242ac120002 Apt 0603",
    "panelRef": "r:a605ccf4-b706-11ec-93c4-0242ac120003",
    "jaffa": "affaj"
};

describe("Haystack tools", () => {
    describe("removePrefix", () => {
        it("should remove prefix if found", () => {
            expect(removePrefix(TEST_ENTITY_2.id)).to.equal("fbf64a12-b706-11ec-a271-0242ac120003");
        });

        it("should not remove prefix if not found", () => {
            expect(removePrefix(TEST_ENTITY_2.jaffa)).to.equal("affaj");
        });
    });

    describe("getId", () => {
        it("should get id from entity if no tag specified", () => {
            expect(getId(TEST_ENTITY_1)).to.equal("fbf64a12-b706-11ec-a271-0242ac120002");
        });

        it("should reject if no id tag on entity", () => {
            try {
                getId(TEST_ENTITY_NO_ID);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("No id present on the entity");
            }
        });

        it("should get id from specified tag of entity if present", () => {
            expect(getId(TEST_ENTITY_2, "siteRef")).to.equal("9a283e08-b706-11ec-8a23-0242ac120002");
        });

        it("should reject if specified tag not present on entity", () => {
            try {
                getId(TEST_ENTITY_2, "affaj");
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Entity does not have tag affaj");
            }
        });

        it("should reject if tag is not a reference tag", () => {
            try {
                getId(TEST_ENTITY_2, "dis");
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Entity tag dis is not a reference tag");
            }
        });

        it("should not trim id if not necessary", () => {
            expect(getId(TEST_ENTITY_2, "panelRef")).to.equal("a605ccf4-b706-11ec-93c4-0242ac120003");
        });
    });

    describe("getReadableName", () => {
        it("should use fqname over id if present", () => {
            expect(getReadableName(TEST_ENTITY_1)).to.equal("300george.apt0603mtr");
        });

        it("should use id if fqname not present", () => {
            expect(getReadableName(TEST_ENTITY_2)).to.equal("fbf64a12-b706-11ec-a271-0242ac120003");
        });
    });
})