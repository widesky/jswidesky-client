/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;
const {verifyRequestCall} = require("./../utils");
const {Ref} = require("../../../src/data");

const QUERY_RESPONSE = require("./files/findAsIdResponse.json");
const QUERY_RESPONSE_AS_IDS = require("./files/findAsIdResponseAsIds.json");

describe('client.findAsId', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.query = sinon.stub().callsFake(() => QUERY_RESPONSE);
    });

    it("should return list of ids", async () => {
        const ids = await ws.findAsId("point");
        expect(ids).to.eql(QUERY_RESPONSE_AS_IDS);
    });

    describe("parameter filter", () => {
        it(`should add '/' where '"' characters are found`, async () => {
            await ws.findAsId(`name=="a-name"`);
            expect(ws.query.calledOnce).to.be.true;
            expect(ws.query.args[0]).to.eql([
                "\n{\n  haystack {\n    search(filter: \"name==\\\"a-name\\\"\", limit: 0) {\n      entity {\n        id\n      }\n    }\n  }\n}\n"
            ]);
        });
    });

    describe("parameter limit", () => {
        it("should use limit in query", async () => {
            await ws.findAsId("test", 111);
            expect(ws.query.calledOnce).to.be.true;
            expect(ws.query.args[0]).to.eql([
                "\n{\n  haystack {\n    search(filter: \"test\", limit: 111) {\n      entity {\n        id\n      }\n    }\n  }\n}\n"
            ]);
        });

        it("should default to 0", async () => {
            await ws.findAsId("test");
            expect(ws.query.calledOnce).to.be.true;
            expect(ws.query.args[0]).to.eql([
                "\n{\n  haystack {\n    search(filter: \"test\", limit: 0) {\n      entity {\n        id\n      }\n    }\n  }\n}\n"
            ]);
        });
    })
});
