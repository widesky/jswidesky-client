/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for HTTP/2 request timeout behaviour.
 *
 * Verifies that _wsRawSubmit does not hang forever when the underlying
 * HTTP/2 connection stalls (e.g. server accepts TLS but never sends
 * the HTTP/2 SETTINGS frame).
 */
'use strict';

const sinon = require('sinon');
const {expect} = require('chai');
const stubs = require('../../stubs');
const WideSkyClient = require('../../../src/client/client');

/**
 * Create a WideSkyClient with the real _wsRawSubmit (not stubbed),
 * then replace the axios instance with a mock.
 */
function createClient(options) {
    const ws = new WideSkyClient(
        stubs.WS_URI,
        stubs.WS_USER,
        stubs.WS_PASSWORD,
        stubs.WS_CLIENT_ID,
        stubs.WS_CLIENT_SECRET,
        new stubs.StubLogger(),
        null,
        options
    );

    return ws;
}

describe('client', () => {
    describe('_wsRawSubmit HTTP/2 timeout', () => {
        it('should reject with a timeout error when axios call never settles',
            async () => {
                const clock = sinon.useFakeTimers();

                try {
                    const REQUEST_TIMEOUT_MS = 200;
                    const ws = createClient({
                        http2: {
                            enabled: true,
                            requestTimeout: REQUEST_TIMEOUT_MS,
                        },
                    });

                    // Stub axios.post to return a promise that never settles,
                    // simulating a hung HTTP/2 session establishment
                    ws.axios.post = sinon.stub().returns(
                        new Promise(() => {})
                    );

                    let error;
                    const pending = ws._wsRawSubmit('POST', '/api/graphql', {
                        query: '{test}',
                    }).catch((e) => { error = e; });

                    // Advance past the timeout threshold
                    clock.tick(REQUEST_TIMEOUT_MS + 1);
                    await pending;

                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('timed out');
                    expect(error.message).to.include('/api/graphql');
                    expect(error.message).to.include('HTTP/2 mode');
                }
                finally {
                    clock.restore();
                }
            }
        );

        it('should not apply timeout when HTTP/2 is disabled', async () => {
            const clock = sinon.useFakeTimers();

            try {
                const REQUEST_TIMEOUT_MS = 200;
                const ws = createClient({
                    http2: {enabled: false},
                });

                // Stub axios.get to never settle; if a timeout were active
                // this would reject after REQUEST_TIMEOUT_MS.
                ws.axios.get = sinon.stub().returns(new Promise(() => {}));

                let settled = false;
                const pending = ws._wsRawSubmit('GET', '/api/test')
                    .then(() => { settled = true; })
                    .catch(() => { settled = true; });

                // Advance time well past what a timeout would be
                clock.tick(REQUEST_TIMEOUT_MS * 10);

                // Allow any resolved microtasks to flush
                await Promise.resolve();

                expect(settled).to.equal(false,
                    'request should still be pending (no timeout applied)');
            }
            finally {
                clock.restore();
            }
        });

        it('should not apply timeout when requestTimeout is 0', async () => {
            const clock = sinon.useFakeTimers();

            try {
                const ws = createClient({
                    http2: {enabled: true, requestTimeout: 0},
                });

                // Stub axios.post to never settle; if a timeout were active
                // this would reject.
                ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                let settled = false;
                const pending = ws._wsRawSubmit('POST', '/api/test', {})
                    .then(() => { settled = true; })
                    .catch(() => { settled = true; });

                // Advance time significantly
                clock.tick(5000);

                // Allow any resolved microtasks to flush
                await Promise.resolve();

                expect(settled).to.equal(false,
                    'request should still be pending (no timeout applied)');
            }
            finally {
                clock.restore();
            }
        });

        it('should return response data when request completes before timeout',
            async () => {
                const clock = sinon.useFakeTimers();

                try {
                    const REQUEST_TIMEOUT_MS = 1000;
                    const RESPONSE_DELAY_MS = 200;
                    const ws = createClient({
                        http2: {enabled: true, requestTimeout: REQUEST_TIMEOUT_MS},
                    });

                    const response = {data: {rows: [{id: '123'}]}};

                    // Stub axios.post to resolve after a delay, before
                    // the timeout fires.
                    ws.axios.post = sinon.stub().returns(
                        new Promise((resolve) => {
                            setTimeout(
                                () => resolve(response), RESPONSE_DELAY_MS
                            );
                        })
                    );

                    const resultPromise = ws._wsRawSubmit(
                        'POST', '/api/read', {}
                    );

                    // Advance past the response delay but before timeout
                    clock.tick(RESPONSE_DELAY_MS + 1);

                    const result = await resultPromise;

                    expect(result).to.deep.equal({rows: [{id: '123'}]});
                    expect(ws.axios.post.calledOnce).to.be.true;
                }
                finally {
                    clock.restore();
                }
            }
        );
    });
});
