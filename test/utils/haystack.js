const {
    removePrefix,
    getId,
    getReadableName,
    toHaystack
} = require("../../src/utils/haystack");
const { expect } = require("chai");

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

        it("should reject if value is of type number", () => {
            try {
                removePrefix(12);
                throw new Error("Should not have worked");
            } catch (error) {
                expect("Value is not of type String");
            }
        });

        it("should reject if value is of type object", () => {
            try {
                removePrefix({});
                throw new Error("Should not have worked");
            } catch (error) {
                expect("Value is not of type String");
            }
        });

        it("should reject if value is of type boolean", () => {
            try {
                removePrefix(true);
                throw new Error("Should not have worked");
            } catch (error) {
                expect("Value is not of type String");
            }
        });

        it("should accept if value is of type string", () => {
            try {
                removePrefix("12");
                throw new Error("Should not have worked");
            } catch (error) {
                expect("Value is not of type String");
            }
        });

        it("should accept if value is of type String", () => {
            try {
                removePrefix(new String("12"));
                throw new Error("Should not have worked");
            } catch (error) {
                expect("Value is not of type String");
            }
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

    describe("toHaystack", () => {
        it("should assign correct prefix for kind 'Str'", () => {
            expect(toHaystack("Hiii", "Str")).to.equal("s:Hiii");
        });

        it("should assign correct prefix for kind 'Ref'", () => {
            expect(toHaystack("parent", "Ref")).to.equal("r:parent");
        });

        it("should assign correct prefix for kind 'Number'", () => {
            expect(toHaystack(123, "Number")).to.equal("n:123");
        });

        it("should assign correct prefix for kind 'Marker'", () => {
            expect(toHaystack(undefined, "Marker")).to.equal("m:");
            expect(toHaystack("av", "Marker")).to.equal("m:");
        });

        it("should assign correct prefix for kind 'Coord'", () => {
            expect(toHaystack("-28.014826,153.429817", "Coord")).to.equal(
                "c:-28.014826,153.429817"
            );
        });

        it("should assign correct prefix for kind 'Time'", () => {
            expect(toHaystack(123, "Time")).to.equal("h:123");
        });

        it("should assign correct prefix for kind 'Date'", () => {
            expect(toHaystack(123, "Date")).to.equal("d:123");
        });

        it("should assign correct prefix for kind 'DateTime'", () => {
            expect(toHaystack(123, "DateTime")).to.equal("t:123");
        });

        it("should assign correct prefix for kind 'Zero'", () => {
            expect(toHaystack(undefined, "Zero")).to.equal("z:");
            expect(toHaystack(123, "Zero")).to.equal("z:");
        });

        it("should assign correct prefix for kind 'Bool'", () => {
            expect(toHaystack(false, "Bool")).to.equal("false");
        });

        it("should assign correct prefix for kind 'Uri'", () => {
            expect(toHaystack(123, "Uri")).to.equal("u:123");
        });

        it("should assign correct prefix for kind 'List'", () => {
            const listExample = "[cccec2b4-cfb3-11ea-99dd-0242ac120002, " +
                "ccf9c2b6-cfb3-11ea-99de-0242ac120002, " +
                "07315226-cfac-11ea-888a-0242ac120002, " +
                "123123, " +
                "cd0dac0e-cfb3-11ea-99df-0242ac120002]";
            expect(toHaystack(listExample, "List")).to.eql([
                "r:cccec2b4-cfb3-11ea-99dd-0242ac120002",
                "r:ccf9c2b6-cfb3-11ea-99de-0242ac120002",
                "r:07315226-cfac-11ea-888a-0242ac120002",
                "s:123123",
                "r:cd0dac0e-cfb3-11ea-99df-0242ac120002"
            ]);
        });

        it("should reject if unknown kind given", () => {
            try {
                toHaystack("abc", "lala");
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Unknown kind lala for value abc");
            }
        })
    });
})