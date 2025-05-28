/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client internals
 */
"use strict";

const sinon = require("sinon");
const expect = require("chai").expect;
const bunyan = require("bunyan");
const proxyquire = require("proxyquire");

const bFormatStub = sinon.stub().returns("formattedStream");

const { initLogger } = proxyquire("../../../src/client/client", {
    "bunyan-format": bFormatStub,
});

describe.only("initLogger", () => {
    let createLoggerStub;

    beforeEach(() => {
        createLoggerStub = sinon
            .stub(bunyan, "createLogger")
            .returns("bunyanLogger");
    });

    afterEach(() => {
        sinon.restore();
    });

    it("should return the passed logger if it's not a plain object", () => {
        const fakeLogger = { constructor: { name: "CustomLogger" } };
        const result = initLogger(fakeLogger);
        expect(result).to.equal(fakeLogger);
        expect(createLoggerStub.called).to.be.false;
    });

    it("should create a logger with default values when called with no args", () => {
        const result = initLogger();
        expect(bFormatStub.called).to.be.true;
        expect(createLoggerStub.calledOnce).to.be.true;
        expect(result).to.equal("bunyanLogger");

        const config = createLoggerStub.firstCall.args[0];
        expect(config.name).to.equal("WideSky-Client");
        expect(config.stream).to.equal("formattedStream");
    });

    it("should merge user config into the logger", () => {
        initLogger({ level: "debug" });
        const config = createLoggerStub.firstCall.args[0];
        expect(config.level).to.equal("debug");
    });

    it("should override stream if raw is true", () => {
        initLogger({ raw: true });
        const config = createLoggerStub.firstCall.args[0];
        expect(config.stream).to.equal(process.stdout);
    });
});
