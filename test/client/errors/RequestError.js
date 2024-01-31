const {RequestError, HaystackError, GraphQLError} = require("../../../src/errors");
const { expect } = require("chai");
const {StubLogger} = require("../../stubs");

describe("RequestError", () => {
    let logger = new StubLogger();
    beforeEach(() => {
        logger.resetHistory();
    });

    describe("make", () => {
        it("should not create RequestError if no response received", () => {
            const error = new Error("Test error");
            const reqError = RequestError.make(error, logger);
            expect(reqError).to.be.instanceof(Error);
        });

        it("should not create RequestError if no data in response", () => {
            // e.g. HTTP 403 errors don't typically have a message
            const error = new Error("Test error");
            error.response = {};
            const reqError = RequestError.make(error, logger);
            expect(reqError).to.be.instanceof(Error);
        });

        it("should not create RequestError if response not like Haystack or GraphQL", () => {
            const error = new Error("Test error");
            error.response = {
                data: {
                    nothingToSee: "here"
                }
            };
            const reqError = RequestError.make(error, logger);
            expect(reqError).to.be.instanceof(Error);
        });

        describe("HaystackError", () => {
            it("should create HaystackError if suitable", ()  => {
                const error = new Error("Test error");
                error.response = {
                    data: {
                        meta: {
                            dis: "s:HBadRequestError: It broken"
                        }
                    }
                };
                const reqError = RequestError.make(error, logger);
                expect(reqError).to.be.instanceof(HaystackError);
                expect(reqError.message).to.equal("HBadRequestError: It broken");
            });
        });

        describe("GraphQLError", () => {
            it("should create GraphQL error if suitable", () => {
                const error = new Error("Test error");
                error.response = {
                    data: {
                        errors: [
                            {
                                "message": "Field \"search\" argument \"whereTag\" of type \"String!\" is required " +
                                    "but not provided.",
                                "locations": [
                                    {
                                        "line": 5,
                                        "column": 5
                                    }
                                ]
                            }
                        ]
                    }
                };
                const reqError = RequestError.make(error, logger);
                expect(reqError).to.be.instanceof(GraphQLError);
                expect(reqError.message).to.equal(
                    "Field \"search\" argument \"whereTag\" of type \"String!\" is required but not provided."
                );
                expect(reqError.errors).to.eql([
                    "Field \"search\" argument \"whereTag\" of type \"String!\" is required but not provided. @ location/s line 5:5"
                ]);
            });
        });

        it("should indicate more than 1 error if found", () => {
            const error = new Error("Test error");
            error.response = {
                data: {
                    errors: [
                        {
                            "message": "Field \"search\" argument \"whereTag\" of type \"String!\" is required " +
                                "but not provided.",
                            "locations": [
                                {
                                    "line": 5,
                                    "column": 5
                                }
                            ]
                        },
                        {
                            "message": "Field blah not blah blah",
                            "locations": [
                                {
                                    "line": 5,
                                    "column": 10
                                }
                            ]
                        }
                    ]
                }
            };
            const reqError = RequestError.make(error, logger);
            expect(reqError).to.be.instanceof(GraphQLError);
            expect(reqError.message).to.equal("More than 1 GraphQLError encountered");
            expect(reqError.errors).to.eql([
                "Field \"search\" argument \"whereTag\" of type \"String!\" is required but not provided. @ location/s line 5:5",
                "Field blah not blah blah @ location/s line 5:10"
            ]);
        });
    });
});
