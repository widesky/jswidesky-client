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
const {AxiosError} = require('axios');
const WideSkyClient = require('../../../src/client/client');
const {isRetryable} = require('../../../src/client/functions/batchRetry');

function createClient(options, baseUri = stubs.WS_URI, accessToken = null) {
    return new WideSkyClient(
        baseUri,
        stubs.WS_USER,
        stubs.WS_PASSWORD,
        stubs.WS_CLIENT_ID,
        stubs.WS_CLIENT_SECRET,
        new stubs.StubLogger(),
        accessToken,
        options
    );
}

/** A still-valid token, so public calls go straight to the request. */
function validToken() {
    return {
        access_token: 'a', refresh_token: 'r',
        expires_in: Date.now() + 3600000, token_type: 'Bearer',
    };
}

/** A client already holding a valid token (no login round trip). */
function createLoggedInClient(options, baseUri = stubs.WS_URI) {
    return createClient(options, baseUri, validToken());
}

/** Await a promise expected to reject; return the error. */
async function rejectionOf(promise) {
    try {
        await promise;
    }
    catch (e) {
        return e;
    }
    throw new Error('expected the promise to reject');
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

            // Precedence: requestTimeout > axios.timeout > http2.requestTimeout > 60000.
            it('prefers options.axios.timeout over the http2.requestTimeout alias', () => {
                // Pre-BAU-1694 this config had a 30 s timeout over HTTP/1.1
                // (from axios.timeout); the alias must not silently drop it.
                expect(createClient({
                    http2: {requestTimeout: 0}, axios: {timeout: 30000},
                }).requestTimeout).to.equal(30000);
                expect(createClient({
                    http2: {requestTimeout: 120000}, axios: {timeout: 30000},
                }).requestTimeout).to.equal(30000);
                expect(createClient({
                    requestTimeout: 0,
                    http2: {requestTimeout: 120000}, axios: {timeout: 30000},
                }).requestTimeout).to.equal(0);
            });

            it('rejects an invalid http2.requestTimeout alias, naming it', () => {
                // -1 used to disable the HTTP/2 timer; it now fails fast.
                expect(() => createClient({http2: {requestTimeout: -1}}))
                    .to.throw(TypeError, /options\.http2\.requestTimeout/);
            });

            it('rejects an invalid axios.timeout, naming it', () => {
                expect(() => createClient({axios: {timeout: 'soon'}}))
                    .to.throw(TypeError, /options\.axios\.timeout/);
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

            it('arms axios with the resolved value, not a raw axios.timeout', () => {
                expect(createClient({
                    requestTimeout: 500, axios: {timeout: 30000},
                }).axios.defaults.timeout).to.equal(500);
                expect(createClient({
                    http2: {requestTimeout: 0}, axios: {timeout: 30000},
                }).axios.defaults.timeout).to.equal(30000);
                expect(createClient({axios: {timeout: '5000'}})
                    .axios.defaults.timeout).to.equal(5000);
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

            it('rejects query() after requestTimeout, naming the path and the ms',
                async () => {
                    const ws = createLoggedInClient({requestTimeout: 300}, server.uri);
                    const started = Date.now();
                    const error = await rejectionOf(ws.query('{ haystack { search { id } } }'));
                    const elapsed = Date.now() - started;

                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('/graphql');
                    expect(error.message).to.include('timed out after 300ms');
                    // Still classified as a network timeout (retryable code).
                    expect(['ECONNABORTED', 'ETIMEDOUT']).to.include(error.code);
                    expect(isRetryable(error)).to.equal(true);
                    expect(elapsed).to.be.at.least(250);
                    expect(elapsed).to.be.below(3000);
                }
            );

            it('applies via the http2.requestTimeout alias with HTTP/2 off',
                async () => {
                    const ws = createLoggedInClient(
                        {http2: {enabled: false, requestTimeout: 300}},
                        server.uri
                    );
                    const error = await rejectionOf(ws.query('{ x }'));
                    expect(error).to.be.an.instanceOf(Error);
                    expect(error.message).to.include('timed out after 300ms');
                }
            );

            it('keeps axios.timeout when the alias is 0', async () => {
                const ws = createLoggedInClient(
                    {http2: {requestTimeout: 0}, axios: {timeout: 300}},
                    server.uri
                );
                const error = await rejectionOf(ws.query('{ x }'));
                expect(error.message).to.include('timed out after 300ms');
            });

            it('releases the stalled connection on timeout', async () => {
                const ws = createClient({requestTimeout: 200}, server.uri);
                await ws.login().catch(() => {});
                // Give the server side a moment to observe the close.
                await new Promise((r) => setTimeout(r, 100));
                expect(server.sockets.size).to.equal(0);
            });

            it('bounds the OAuth token request too', async () => {
                const ws = createClient({requestTimeout: 300}, server.uri);
                const error = await rejectionOf(ws.login());
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('/oauth2/token');
                expect(error.message).to.include('timed out after 300ms');
            });

            it('bounds a full query() including the token request', async () => {
                // No token held: query() logs in first, and that stalls.
                const ws = createClient({requestTimeout: 300}, server.uri);
                const error = await rejectionOf(ws.query('{ x }'));
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('timed out after 300ms');
            });

            it('lets a per-call timeout win over requestTimeout', async () => {
                const ws = createLoggedInClient({requestTimeout: 5000}, server.uri);
                const started = Date.now();
                const error = await rejectionOf(
                    ws.submitRequest('GET', '/api/read', {}, {timeout: 250}));
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('timed out after 250ms');
                expect(Date.now() - started).to.be.below(2000);
            });

            it('accepts a numeric-string per-call timeout', async () => {
                const ws = createLoggedInClient({requestTimeout: 5000}, server.uri);
                const error = await rejectionOf(
                    ws.submitRequest('GET', '/api/read', {}, {timeout: '250'}));
                expect(error.message).to.include('timed out after 250ms');
            });

            it('treats a null per-call timeout as unset (instance value applies)',
                async () => {
                    const ws = createLoggedInClient({requestTimeout: 300}, server.uri);
                    const error = await rejectionOf(
                        ws.submitRequest('GET', '/api/read', {}, {timeout: null}));
                    expect(error.message).to.include('timed out after 300ms');
                }
            );

            it('does not time out when requestTimeout is 0', async () => {
                const ws = createLoggedInClient({requestTimeout: 0}, server.uri);
                let settled = false;
                const pending = ws.query('{ x }')
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

        describe('per-call timeout validation', () => {
            for (const bad of [-1, NaN, Infinity, 'abc', '', {}]) {
                const label = typeof bad === 'string' ? JSON.stringify(bad) : String(bad);
                it(`rejects (not throws) an invalid per-call timeout (${label})`, async () => {
                    const ws = createLoggedInClient({requestTimeout: 1000});
                    const get = sinon.stub().resolves({data: {}});
                    ws.axios.get = get;

                    let promise;
                    expect(() => {
                        promise = ws.submitRequest('GET', '/api/read', {}, {timeout: bad});
                    }).to.not.throw();
                    const error = await rejectionOf(promise);

                    expect(error).to.be.an.instanceOf(TypeError);
                    expect(error.message).to.include('timeout for GET /api/read');
                    expect(get.called).to.equal(false, 'no request should be sent');
                });
            }

            it('also validates on HTTP/2', async () => {
                const ws = createLoggedInClient({http2: {enabled: true}});
                const post = sinon.stub().resolves({data: {}});
                ws.axios.post = post;
                const error = await rejectionOf(
                    ws.submitRequest('POST', '/api/x', {}, {timeout: -1}));
                expect(error).to.be.an.instanceOf(TypeError);
                expect(error.message).to.include('timeout for POST /api/x');
                expect(post.called).to.equal(false);
            });

            it('passes the normalised per-call timeout to axios', async () => {
                const ws = createLoggedInClient({requestTimeout: 1000});
                const get = sinon.stub().resolves({data: {ok: true}});
                ws.axios.get = get;

                await ws.submitRequest('GET', '/api/read', {}, {timeout: '250'});
                expect(get.firstCall.args[1].timeout).to.equal(250);

                await ws.submitRequest('GET', '/api/read', {}, {timeout: null});
                expect(get.secondCall.args[1]).to.not.have.property('timeout');
            });
        });

        describe('HTTP/2 mode', () => {
            let clock;

            beforeEach(() => {
                clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
            });

            afterEach(() => {
                clock.restore();
            });

            it('uses a per-call timeout for the race when given', async () => {
                const ws = createLoggedInClient({
                    http2: {enabled: true},
                    requestTimeout: 60000,
                });
                ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                let error;
                const pending = ws.submitRequest('POST', '/api/x', {},
                    {timeout: 100}).catch((e) => { error = e; });
                await clock.tickAsync(101);
                await pending;

                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.include('/api/x');
                expect(error.message).to.include('timed out after 100ms');
            });

            it('races query() on options.requestTimeout', async () => {
                const ws = createLoggedInClient({
                    http2: {enabled: true},
                    requestTimeout: 150,
                });
                ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                let error;
                const pending = ws.query('{ x }').catch((e) => { error = e; });
                await clock.tickAsync(151);
                await pending;

                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.equal(
                    'Request to /graphql timed out after 150ms (HTTP/2 mode)');
            });

            it('races on axios.timeout ahead of the alias', async () => {
                const ws = createLoggedInClient({
                    http2: {enabled: true, requestTimeout: 120000},
                    axios: {timeout: 150},
                });
                ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                let error;
                const pending = ws.query('{ x }').catch((e) => { error = e; });
                await clock.tickAsync(151);
                await pending;

                expect(error.message).to.include('timed out after 150ms');
            });

            it('gives its race timeout code ETIMEDOUT, so batch retries treat it as transient',
                async () => {
                    const ws = createLoggedInClient({
                        http2: {enabled: true},
                        requestTimeout: 150,
                    });
                    ws.axios.post = sinon.stub().returns(new Promise(() => {}));

                    let error;
                    const pending = ws.query('{ x }').catch((e) => { error = e; });
                    await clock.tickAsync(151);
                    await pending;

                    expect(error.code).to.equal('ETIMEDOUT');
                    expect(isRetryable(error)).to.equal(true);
                }
            );

            it('rewords axios\'s own timeout error when it fires before the race', async () => {
                const ws = createLoggedInClient({
                    http2: {enabled: true},
                    requestTimeout: 100,
                });
                // axios's socket timer (armed alongside the race) wins.
                ws.axios.post = sinon.stub().rejects(new AxiosError(
                    'timeout of 100ms exceeded', AxiosError.ECONNABORTED));

                const error = await rejectionOf(ws.query('{ x }'));

                expect(error).to.be.an.instanceOf(AxiosError);
                expect(error.message).to.equal(
                    'Request to /graphql timed out after 100ms (HTTP/2 mode)');
                expect(error.code).to.equal('ETIMEDOUT');
                expect(isRetryable(error)).to.equal(true);
            });

            it('leaves other HTTP/2 errors untouched', async () => {
                const ws = createLoggedInClient({
                    http2: {enabled: true},
                    requestTimeout: 100,
                });
                ws.axios.post = sinon.stub().rejects(new AxiosError(
                    'socket hang up', 'ECONNRESET'));

                const error = await rejectionOf(ws.query('{ x }'));

                expect(error.message).to.equal('socket hang up');
                expect(error.code).to.equal('ECONNRESET');
            });
        });
    });
});
