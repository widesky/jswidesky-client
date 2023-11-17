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

describe("client.batch.multiFind", () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.batch.query = sinon.stub().callsFake((query) =>  {});
    });

    describe("parameter filterAndLimits", () => {
        it("should reject if not a Array", async () => {
            try {
                await ws.batch.multiFind("a");
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("parameter filterAndLimits is not a 2D Array as specified");
            }
        });

        it("should reject if not a 2D Array", async () => {
            try {
                await ws.batch.multiFind(["a"]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("parameter filterAndLimits is not a 2D Array as specified");
            }
        });

        it("should reject if element of 2D array is empty", async () => {
            try {
                await ws.batch.multiFind([["a", 1], "b"]);
                throw new Error("Should not have worked");
            } catch (error) {
                expect(error.message).to.equal("parameter filterAndLimits is not a 2D Array as specified");
            }
        });
    });

    describe("query creation", () => {
        it("should create query for one filter and limit", async () => {

        });

        it("should create more than 1 query for more than 1 filter and limit", async () => {

        });

        it("should set limit as 0 when not specified", async () => {

        });
    });

    describe("parsing to Haystack response", () => {
        it("should handle 1 query response", async () => {

        });

        it("should handle 1 query response with multiple filter responses", async () => {

        });

        it("should handle multiple query responses, each with 1 filter response", async () => {

        });

        it("should handle multiple query responses, each with multiple filter responses", async () => {

        });
    });
});