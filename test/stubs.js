/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit test stubs
 * (C) 2018 VRT Systems
 */
"use strict";

const sinon = require('sinon');

/**
 * StubLogger is a logger object that spoofs a Bunyan-style logger.
 */
const StubLogger = function() {
    const self = this;
    ['fatal','error','warn','info','debug','trace'].forEach((l) => {
        self[l] = sinon.stub();
    });
};

/**
 * StubHTTPStatusCodeError is a class that mimics the `StatusCodeError`
 * in `request-promise`.
 */
const StubHTTPStatusCodeError = function(message) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = message;
};
require('util').inherits(StubHTTPStatusCodeError, Error);

/**
 * StubHTTPClient is a class that mimics `request-promise`'s interface whilst
 * providing a means to "spoof" a response as if a real HTTP request had been
 * made and the response returned.
 */
const StubHTTPClient = function() {
    const self = this;
    var handler = null;

    /**
     * Assign a new handler that will receive the request and generate the
     * expected response.  Handler is expected to take a simple `options`
     * object in the same manner as `request-promise` and either throw an
     * exception to terminate the test, or to return the expected data.
     *
     * See https://github.com/request/request-promise for an idea of how we
     * need to behave.  The WideSky client really doesn't use much.
     *
     * This may be replaced at any time.
     */
    self.setHandler = function(h) {
        handler = h;
    };

    /**
     * Stub a WideSkyClient instance with this HTTP client instance.
     */
    self.stubClient = function(ws) {
        ws._request = (options) => {
            return handler(options);
        };
        ws._rqerr = {
            StatusCodeError: StubHTTPStatusCodeError
        };
    };
};

/* Exported symbols */
module.exports = {
    StubLogger: StubLogger,
    StubHTTPClient: StubHTTPClient,
    StubHTTPStatusCodeError: StubHTTPStatusCodeError
};
