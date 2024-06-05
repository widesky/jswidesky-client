const HisWritePayload = require("../../src/utils/hisWritePayload");
const { expect } = require("chai");

describe("HisWritePayload", () => {
    describe("addData", () => {
        const hisWritePayload = new HisWritePayload();
        beforeEach(() => {
            hisWritePayload.reset();
        })

        it("should be able to add 1 data row for an entity", () => {
            hisWritePayload.add("r:testId", [
                {
                    ts: "t:123",
                    val: "n:1278"
                }
            ]);
            expect(hisWritePayload.payload).to.eql({
                "t:123": {
                    "r:testId": "n:1278"
                }
            });
        });

        it("should be able to add 2 data rows for an entity", () => {
            hisWritePayload.add("r:testId", [
                {
                    ts: "t:123",
                    val: "n:1278"
                },
                {
                    ts: "t:124",
                    val: "n:999"
                }
            ]);
            expect(hisWritePayload.payload).to.eql({
                "t:123": {
                    "r:testId": "n:1278"
                },
                "t:124": {
                    "r:testId": "n:999"
                }
            });
        });

        it("should be able to rows for 2 different entities", () => {
            hisWritePayload.add("r:testId", [
                {
                    ts: "t:123",
                    val: "n:1278"
                }
            ]);
            hisWritePayload.add("r:testId2", [
                {
                    ts: "t:124",
                    val: "n:999"
                }
            ]);
            expect(hisWritePayload.payload).to.eql({
                "t:123": {
                    "r:testId": "n:1278"
                },
                "t:124": {
                    "r:testId2": "n:999"
                }
            });
        });

        it("should combine common timestamps for different entities", () => {
            hisWritePayload.add("r:testId", [
                {
                    ts: "t:123",
                    val: "n:1278"
                }
            ]);
            hisWritePayload.add("r:testId2", [
                {
                    ts: "t:123",
                    val: "n:999"
                }
            ]);
            expect(hisWritePayload.payload).to.eql({
                "t:123": {
                    "r:testId": "n:1278",
                    "r:testId2": "n:999"
                }
            });
        });

        it("should reject if row in data missing ts property", () => {
            try {
                hisWritePayload.add("r:testId", [
                    {
                        val: "n:123"
                    }
                ]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Row in data missing 'ts' property");
            }
        });

        it("should reject if row in data missing val property", () => {
            try {
                hisWritePayload.add("r:testId", [
                    {
                        ts: "t:123"
                    }
                ]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("Row in data missing 'val' property");
            }
        });

        it("should reject if val in row missing haystack prefix", () => {
            try {
                hisWritePayload.add("r:testId", [{
                    ts: "t:123123",
                    val: "false"
                }])
            } catch (error) {
                expect(error.message).to.equal("'val' in row 0 missing Haystack prefix");
            }
        });

        it("should reject if id not a string", () => {
            try {
                hisWritePayload.add(123, [{
                    ts: "t:123123",
                    val: "n:1"
                }])
            } catch (error) {
                expect(error.message).to.equal("Id must be a string");
            }
        });

        it("should reject if id not a Haystack string", () => {
            try {
                hisWritePayload.add("testId", [{
                    ts: "t:123123",
                    val: "n:2"
                }])
            } catch (error) {
                expect(error.message).to.equal("Id must have Haystack reference type suffix applied");
            }
        });

        it("should handle Number data with unit also included", () => {
            hisWritePayload.add("r:testId", [
                {
                    ts: "t:123",
                    val: "n:1278 kW"
                }
            ]);
            expect(hisWritePayload.payload).to.eql({
                "t:123": {
                    "r:testId": "n:1278",
                }
            });
        });

        it("should accept bool values", () => {
            hisWritePayload.add("r:testId",[{
                ts: "t:123123",
                val: true
            }]);
            expect(hisWritePayload.payload).to.eql({
                "t:123123": {
                    "r:testId": true,
                }
            });
        })
    });
});