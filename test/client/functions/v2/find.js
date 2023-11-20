/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../../stubs');
const sinon = require('sinon');
const findResult = require("./files/findExample.json");
const expect = require('chai').expect;
const getInstance = stubs.getInstance;

describe('client.v2.find', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
    });

    it("should call existing client.find function", async () => {
        ws.find = sinon.stub().returnsThis({rows: []});
        await ws.v2.find("test", 12);
        expect(ws.find.calledOnce).to.be.true;
        expect(ws.find.args[0]).to.eql(["test", 12]);
    });

    it("should return only the rows", async () => {
        const findResult = require("./files/findExample.json");
        ws.find = sinon.stub().callsFake(async (...args) => findResult);
        const result = await ws.v2.find("test", 12);
        expect(result).to.be.instanceof(Array);
        expect(result).to.eql(findResult.rows);
    });
});