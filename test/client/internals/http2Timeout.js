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
                const REQUEST_TIMEOUT_MS = 200;
                const ws = createClient({
                    http2: {
                        enabled: true,
                        requestTimeout: REQUEST_TIMEOUT_MS,
                    },
                });

                // Stub axios.post to return a promise that never settles,
                // simulating a hung HTTP/2 session establishment
                ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                const start = Date.now();
                let error;

                try {
                    await ws._wsRawSubmit('POST', '/api/graphql', {
                        query: '{test}',
                    });
                }
                catch (e) {
                    error = e;
                }

                const elapsed = Date.now() - start;

                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('timed out');
                expect(error.message).to.include('/api/graphql');
                expect(error.message).to.include('HTTP/2 mode');

                expect(elapsed).to.be.greaterThanOrEqual(REQUEST_TIMEOUT_MS - 50);
                expect(elapsed).to.be.lessThan(REQUEST_TIMEOUT_MS + 500);
            }
        );

        it('should not apply timeout when HTTP/2 is disabled', async () => {
            const ws = createClient({});

            const response = {data: {ok: true}};
            ws.axios.get = sinon.stub().resolves(response);

            const result = await ws._wsRawSubmit('GET', '/api/test');

            expect(result).to.deep.equal({ok: true});
            expect(ws.axios.get.calledOnce).to.be.true;
        });

        it('should not apply timeout when requestTimeout is 0', async () => {
            const ws = createClient({
                http2: {enabled: true, requestTimeout: 0},
            });

            const response = {data: {ok: true}};
            ws.axios.post = sinon.stub().resolves(response);

            const result = await ws._wsRawSubmit('POST', '/api/test', {});

            expect(result).to.deep.equal({ok: true});
            expect(ws.axios.post.calledOnce).to.be.true;
        });

        it('should return response data when request completes before timeout',
            async () => {
                const ws = createClient({
                    http2: {enabled: true, requestTimeout: 5000},
                });

                const response = {data: {rows: [{id: '123'}]}};
                ws.axios.post = sinon.stub().resolves(response);

                const result = await ws._wsRawSubmit('POST', '/api/read', {});

                expect(result).to.deep.equal({rows: [{id: '123'}]});
                expect(ws.axios.post.calledOnce).to.be.true;
            }
        );
    });
});
