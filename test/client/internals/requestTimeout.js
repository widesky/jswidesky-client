/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * BAU-1694: the client's request timeout applies over HTTP/1.1 as well as
 * HTTP/2. Before this, `http2.requestTimeout` (default 60 s) only guarded
 * HTTP/2 requests; over plain HTTP/1.1 axios ran with `timeout: 0`, so a
 * half-open TCP connection left a request (and anything queued behind it)
 * pending forever.
 */
'use strict';

const net = require('net');
const sinon = require('sinon');
const {expect} = require('chai');
const stubs = require('../../stubs');
const WideSkyClient = require('../../../src/client/client');

function createClient(options, baseUri = stubs.WS_URI) {
    return new WideSkyClient(
        baseUri,
        stubs.WS_USER,
        stubs.WS_PASSWORD,
        stubs.WS_CLIENT_ID,
        stubs.WS_CLIENT_SECRET,
        new stubs.StubLogger(),
        null,
        options
    );
}

/**
 * A TCP server that accepts every connection and never answers, standing in
 * for a half-open flow: the request is written, nothing ever comes back.
 */
async function startBlackholeServer() {
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        // Swallow whatever is sent; never write a response.
        socket.on('data', () => {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        uri: `http://127.0.0.1:${server.address().port}`,
        sockets,
        close: () => new Promise((resolve) => {
            for (const s of sockets) s.destroy();
            server.close(() => resolve());
        }),
    };
}

describe('client', () => {
    describe('request timeout (BAU-1694)', () => {
        describe('requestTimeout getter', () => {
            it('defaults to 60000 ms', () => {
                expect(createClient({}).requestTimeout).to.equal(60000);
                expect(createClient().requestTimeout).to.equal(60000);
            });

            it('returns options.requestTimeout', () => {
                expect(createClient({requestTimeout: 1234}).requestTimeout)
                    .to.equal(1234);
            });

            it('returns 0 when disabled', () => {
                expect(createClient({requestTimeout: 0}).requestTimeout)
                    .to.equal(0);
            });

            it('accepts http2.requestTimeout as an alias', () => {
                expect(createClient({http2: {requestTimeout: 4321}})
                    .requestTimeout).to.equal(4321);
                expect(createClient({http2: {requestTimeout: 0}})
                    .requestTimeout).to.equal(0);
            });

            it('prefers options.requestTimeout over http2.requestTimeout', () => {
                const ws = createClient({
                    requestTimeout: 1000,
                    http2: {requestTimeout: 2000},
                });
                expect(ws.requestTimeout).to.equal(1000);
            });

            it('falls back to options.axios.timeout before the default', () => {
                expect(createClient({axios: {timeout: 3000}}).requestTimeout)
                    .to.equal(3000);
                expect(createClient({
                    requestTimeout: 1000, axios: {timeout: 3000},
                }).requestTimeout).to.equal(1000);
            });

            it('treats a null requestTimeout as unset', () => {
                expect(createClient({requestTimeout: null}).requestTimeout)
                    .to.equal(60000);
                expect(createClient({
                    requestTimeout: null, http2: {requestTimeout: 900},
                }).requestTimeout).to.equal(900);
            });

            it('is read-only', () => {
                const ws = createClient({requestTimeout: 1000});
                expect(() => { ws.requestTimeout = 5; }).to.throw(TypeError);
                expect(ws.requestTimeout).to.equal(1000);
            });

            for (const bad of [-1, NaN, Infinity, 'abc', '', '-5', {}]) {
                it(`rejects an invalid requestTimeout (${typeof bad === 'string' ? JSON.stringify(bad) : String(bad)})`, () => {
                    expect(() => createClient({requestTimeout: bad}))
                        .to.throw(TypeError, /requestTimeout/);
                });
            }

            // axios itself accepts a numeric-string `timeout` (it parseInt()s it), so a
            // consumer passing e.g. axios.timeout: '5000' must keep working.
            it('accepts numeric strings, as axios does', () => {
                expect(createClient({requestTimeout: '500'}).requestTimeout).to.equal(500);
                expect(createClient({http2: {requestTimeout: ' 750 '}}).requestTimeout)
                    .to.equal(750);
                expect(createClient({axios: {timeout: '5000'}}).requestTimeout).to.equal(5000);
            });
        });

        describe('axios instance default', () => {
            it('sets the effective timeout as the axios default', () => {
                expect(createClient({requestTimeout: 777}).axios.defaults.timeout)
                    .to.equal(777);
                expect(createClient({}).axios.defaults.timeout)
                    .to.equal(60000);
                expect(createClient({requestTimeout: 0}).axios.defaults.timeout)
                    .to.equal(0);
            });
        });

        describe('over HTTP/1.1 against a server that never responds', () => {
            let server;

            beforeEach(async () => {
                server = await startBlackholeServer();
            });

            afterEach(async () => {
                await server.close();
            });

            it('rejects after requestTimeout, naming the path and the ms',
                async () => {
                    const ws = createClient({requestTimeout: 300}, server.uri);
                    const started = Date.now();
                    let error;
                    try {
                        await ws._wsRawSubmit('GET', '/api/read');
                    }
                    catch (e) {
                        error = e;
                    }
                    const elapsed = Date.now() - started;

                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('/api/read');
                    expect(error.message).to.include('timed out after 300ms');
                    // Still classified as a network timeout (retryable code).
                    expect(['ECONNABORTED', 'ETIMEDOUT']).to.include(error.code);
                    expect(elapsed).to.be.at.least(250);
                    expect(elapsed).to.be.below(3000);
                }
            );

            it('applies via the http2.requestTimeout alias with HTTP/2 off',
                async () => {
                    const ws = createClient(
                        {http2: {enabled: false, requestTimeout: 300}},
                        server.uri
                    );
                    let error;
                    try {
                        await ws._wsRawSubmit('POST', '/api/graphql', {});
                    }
                    catch (e) {
                        error = e;
                    }
                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('timed out after 300ms');
                }
            );

            it('releases the stalled connection on timeout', async () => {
                const ws = createClient({requestTimeout: 200}, server.uri);
                await ws._wsRawSubmit('GET', '/api/read').catch(() => {});
                // Give the server side a moment to observe the close.
                await new Promise((r) => setTimeout(r, 100));
                expect(server.sockets.size).to.equal(0);
            });

            it('bounds the OAuth token request too', async () => {
                const ws = createClient({requestTimeout: 300}, server.uri);
                let error;
                try {
                    await ws.login();
                }
                catch (e) {
                    error = e;
                }
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('/oauth2/token');
                expect(error.message).to.include('timed out after 300ms');
            });

            it('bounds a full submitRequest (token + request)', async () => {
                const ws = createClient({requestTimeout: 300}, server.uri);
                ws._ws_token = {
                    access_token: 'a', refresh_token: 'r',
                    expires_in: Date.now() + 3600000, token_type: 'Bearer',
                };
                ws._ws_token_deadline = ws._ws_token.expires_in;
                let error;
                try {
                    await ws.submitRequest('GET', '/api/read');
                }
                catch (e) {
                    error = e;
                }
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('timed out after 300ms');
            });

            it('lets a per-call timeout win over requestTimeout', async () => {
                const ws = createClient({requestTimeout: 5000}, server.uri);
                const started = Date.now();
                let error;
                try {
                    await ws._wsRawSubmit('GET', '/api/read', undefined,
                        {timeout: 250});
                }
                catch (e) {
                    error = e;
                }
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('timed out after 250ms');
                expect(Date.now() - started).to.be.below(2000);
            });

            it('does not time out when requestTimeout is 0', async () => {
                const ws = createClient({requestTimeout: 0}, server.uri);
                let settled = false;
                const pending = ws._wsRawSubmit('GET', '/api/read')
                    .then(() => { settled = true; }, () => { settled = true; });
                await new Promise((r) => setTimeout(r, 400));
                expect(settled).to.equal(false,
                    'request should still be pending (timeout disabled)');
                // Tear the connection down so the request settles.
                await server.close();
                await pending;
                server = await startBlackholeServer();
            });
        });

        describe('HTTP/2 mode', () => {
            it('uses a per-call timeout for the race when given', async () => {
                const clock = sinon.useFakeTimers();
                try {
                    const ws = createClient({
                        http2: {enabled: true},
                        requestTimeout: 60000,
                    });
                    ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                    let error;
                    const pending = ws._wsRawSubmit('POST', '/api/x', {},
                        {timeout: 100}).catch((e) => { error = e; });
                    clock.tick(101);
                    await pending;

                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('/api/x');
                    expect(error.message).to.include('timed out after 100ms');
                }
                finally {
                    clock.restore();
                }
            });

            it('races on options.requestTimeout', async () => {
                const clock = sinon.useFakeTimers();
                try {
                    const ws = createClient({
                        http2: {enabled: true},
                        requestTimeout: 150,
                    });
                    ws.axios.get = sinon.stub().returns(new Promise(() => {}));

                    let error;
                    const pending = ws._wsRawSubmit('GET', '/api/y')
                        .catch((e) => { error = e; });
                    clock.tick(151);
                    await pending;

                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('timed out after 150ms');
                }
                finally {
                    clock.restore();
                }
            });
        });
    });
});
