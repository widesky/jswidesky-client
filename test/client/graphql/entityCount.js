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

const QUERY_RESPONSE = require("./files/entityCountResponse.json");

describe('client.entityCount', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
        ws.query = sinon.stub().callsFake(() => QUERY_RESPONSE);
    });

    it('should return number of entities found', async () => {
        expect(await ws.entityCount("point")).to.equal(30);
        expect(ws.query.calledOnce).to.be.true;
    });

    it(`should add '/' where '"' characters are found`, async () =>{
        await ws.entityCount(`name=="a-name"`);
        expect(ws.query.calledOnce).to.be.true;
        expect(ws.query.args[0]).to.eql([
            "\n{\n  haystack {\n    search(filter: \"name==\\\"a-name\\\"\", limit: 0) {\n      count\n    }\n  }\n}\n"
        ]);
    });
});