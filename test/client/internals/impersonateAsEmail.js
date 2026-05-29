/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for WideSkyClient.impersonateAsEmail and related impersonation
 * hardening (CORE-8484).
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WideSkyClient = require('../../../src/client/client'),
    getInstance = stubs.getInstance,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN;

// Test-only access to the module-private Symbol used by the lookup helper
// to bypass the _impersonateLookup join in _attachReqConfig. Exposed via
// the test-hook static on WideSkyClient (see `_skipImpersonateJoinSymbol`
// at the bottom of client.js).
const SKIP_IMPERSONATE_JOIN = WideSkyClient._skipImpersonateJoinSymbol;

// Real v4 UUIDs - exercised across both the `_impersonate` field and the
// matched-account `userRef`. Anything non-UUID is rejected by the hardened
// validators.
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID_B = '11111111-2222-4333-8444-555555555555';
const UUID_PRIOR = '99999999-8888-4777-8666-555555555555';

function constructWithOptions(log, clientOptions) {
    return new WideSkyClient(
        stubs.WS_URI,
        stubs.WS_USER,
        stubs.WS_PASSWORD,
        stubs.WS_CLIENT_ID,
        stubs.WS_CLIENT_SECRET,
        log,
        undefined,
        { client: clientOptions }
    );
}

function stubAuthAndDefaultRequests(client) {
    client._wsRawSubmit = sinon.stub().callsFake((method, uri) => {
        if (uri === '/oauth2/token') {
            return Promise.resolve({
                access_token: WS_ACCESS_TOKEN,
                refresh_token: WS_REFRESH_TOKEN,
                expires_in: Date.now() + 2000
            });
        }
        return Promise.resolve('default response');
    });
}

// Stub `_wsRawSubmit` at the transport layer. N1's deadlock is invisible
// when `ws.v2.find` is stubbed at the public surface, so several tests below
// drive the impersonation machinery through the real `v2.find -> submitRequest
// -> _attachReqConfig` chain by stubbing only at the wire boundary.
function stubTransport(client, opts = {}) {
    const calls = [];
    client._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
        calls.push({ method, uri, body, config });
        if (uri === '/oauth2/token') {
            return Promise.resolve({
                access_token: WS_ACCESS_TOKEN,
                refresh_token: WS_REFRESH_TOKEN,
                expires_in: Date.now() + 2000
            });
        }
        if (uri === '/api/read') {
            const action = opts.onRead && opts.onRead({ method, uri, body, config, calls });
            if (action) return action;
            // Default: respond with one matching row carrying UUID_A.
            return Promise.resolve({
                meta: { ver: '2.0' },
                cols: [{ name: 'id' }, { name: 'userRef' }],
                rows: [{ userRef: 'r:' + UUID_A }]
            });
        }
        return Promise.resolve('default response');
    });
    return calls;
}

// Wrap a promise in a deadline so a self-deadlocked path fails the test
// rather than hanging the suite.
function withTimeout(p, ms = 1000, label = 'operation') {
    return Promise.race([
        p,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms)
        ),
    ]);
}

describe('client', () => {
    describe('impersonateAsEmail', () => {
        let http;
        let log;
        let ws;

        beforeEach(() => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
        });

        afterEach(() => sinon.restore());

        it('resolves and sets the impersonation user id', async () => {
            sinon.stub(ws, 'submitRequest').resolves({
                rows: [{ userRef: 'r:' + UUID_A + ' Alice' }]
            });

            const resolved = await ws.impersonateAsEmail('alice@example.com');

            expect(resolved).to.equal(UUID_A);
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal(UUID_A);
            expect(ws.submitRequest.calledOnce).to.equal(true);
            const [method, uri, body, config] = ws.submitRequest.firstCall.args;
            expect(method).to.equal('POST');
            expect(uri).to.equal('/api/read');
            expect(body.rows[0].filter).to.equal(
                's:account and email==\"alice@example.com\"'
            );
            expect(body.rows[0].limit).to.equal('n:2');
            expect(config[SKIP_IMPERSONATE_JOIN]).to.equal(true);
        });

        it('throws when no account matches (redacted message + raw email on err)', async () => {
            sinon.stub(ws, 'submitRequest').resolves({ rows: [] });

            let err;
            try {
                await ws.impersonateAsEmail('missing@example.com');
            } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('No account found for email m***@example.com');
            expect(err.email).to.equal('missing@example.com');
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('throws when more than one account matches (H7)', async () => {
            sinon.stub(ws, 'submitRequest').resolves({
                rows: [
                    { userRef: 'r:' + UUID_A },
                    { userRef: 'r:' + UUID_B }
                ]
            });

            let err;
            try { await ws.impersonateAsEmail('dup@example.com'); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('Multiple accounts (2) found for email d***@example.com');
            expect(err.email).to.equal('dup@example.com');
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('throws when matched account has no userRef tag', async () => {
            sinon.stub(ws, 'submitRequest').resolves({ rows: [{}] });

            let err;
            try { await ws.impersonateAsEmail('noref@example.com'); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('Account for n***@example.com has no userRef tag');
            expect(err.email).to.equal('noref@example.com');
        });

        it('throws when extracted userRef is not a valid UUID (H2)', async () => {
            sinon.stub(ws, 'submitRequest').resolves({
                rows: [{ userRef: 'r:not-a-uuid' }]
            });

            let err;
            try { await ws.impersonateAsEmail('bad@example.com'); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'Account for b***@example.com has a malformed userRef (not a UUID): not-a-uuid'
            );
            expect(err.email).to.equal('bad@example.com');
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('throws TypeError on empty email (H8)', async () => {
            let err;
            try { await ws.impersonateAsEmail(''); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(TypeError);
            expect(err.message).to.equal(
                'impersonateAsEmail requires a non-empty email string'
            );
        });

        it('throws TypeError on whitespace-only email (H8)', async () => {
            let err;
            try { await ws.impersonateAsEmail('   '); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(TypeError);
        });

        it('throws TypeError on non-string email (H8)', async () => {
            let err;
            try { await ws.impersonateAsEmail(undefined); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(TypeError);
        });

        it('trims email before escaping/sending (N3)', async () => {
            const submit = sinon.stub(ws, 'submitRequest').resolves({
                rows: [{ userRef: 'r:' + UUID_A }]
            });
            await ws.impersonateAsEmail('  alice@example.com  ');
            expect(submit.firstCall.args[2].rows[0].filter).to.equal(
                's:account and email==\"alice@example.com\"'
            );
        });

        it('logs the email-to-userId mapping at debug, not info (PII)', async () => {
            sinon.stub(ws, 'submitRequest').resolves({
                rows: [{ userRef: 'r:' + UUID_A }]
            });

            await ws.impersonateAsEmail('alice@example.com');

            // N5: the debug log carries both the email AND the user id.
            expect(log.debug.calledWith(
                'Resolved impersonation email %s to user ID %s',
                'alice@example.com',
                UUID_A
            )).to.equal(true);
            expect(log.info.calledWith(
                'Now impersonating as user ID %s',
                UUID_A
            )).to.equal(true);
            // Email must NEVER reach info-level logs.
            const infoArgs = log.info.getCalls().flatMap((c) => c.args);
            expect(infoArgs.some((a) =>
                typeof a === 'string' && a.includes('alice@example.com')
            )).to.equal(false);
        });

        it('two-pass escape: backslashes then quotes (H1)', async () => {
            const submit = sinon.stub(ws, 'submitRequest').resolves({
                rows: [{ userRef: 'r:' + UUID_A }]
            });
            await ws.impersonateAsEmail('a\\"b@example.com');
            expect(submit.firstCall.args[2].rows[0].filter).to.equal(
                's:account and email==\"a\\\\\\"b@example.com\"'
            );
        });

        it('escapes a bare backslash even when no quote is present (H1)', async () => {
            const submit = sinon.stub(ws, 'submitRequest').resolves({
                rows: [{ userRef: 'r:' + UUID_A }]
            });
            await ws.impersonateAsEmail('a\\b@example.com');
            expect(submit.firstCall.args[2].rows[0].filter).to.equal(
                's:account and email==\"a\\\\b@example.com\"'
            );
        });

        it('lookup runs unimpersonated even when caller has active impersonation (H5)', async () => {
            ws.impersonateAs(UUID_PRIOR);
            let impersonateDuringFind = null;
            const submit = sinon.stub(ws, 'submitRequest').callsFake(() => {
                impersonateDuringFind = ws._impersonate;
                return Promise.resolve({ rows: [{ userRef: 'r:' + UUID_B }] });
            });
            await ws.impersonateAsEmail('switch@example.com');
            expect(impersonateDuringFind).to.equal(null);
            expect(ws._impersonate).to.equal(UUID_B);
            // N1: the lookup's own submitRequest carries the bypass flag.
            expect(submit.firstCall.args[3][SKIP_IMPERSONATE_JOIN]).to.equal(true);
        });

        describe('H5/N6: restores prior impersonation on every failure branch', () => {
            const failures = [
                {
                    label: 'lookup rejects',
                    stub: (stubFn) => stubFn.rejects(new Error('network')),
                    msgIncludes: 'network',
                },
                {
                    label: 'no account matches',
                    stub: (stubFn) => stubFn.resolves({ rows: [] }),
                    msgIncludes: 'No account found',
                },
                {
                    label: 'multiple accounts match',
                    stub: (stubFn) => stubFn.resolves({
                        rows: [{ userRef: 'r:' + UUID_A }, { userRef: 'r:' + UUID_B }]
                    }),
                    msgIncludes: 'Multiple accounts',
                },
                {
                    label: 'missing userRef',
                    stub: (stubFn) => stubFn.resolves({ rows: [{}] }),
                    msgIncludes: 'has no userRef tag',
                },
                {
                    label: 'malformed userRef',
                    stub: (stubFn) => stubFn.resolves({ rows: [{ userRef: 'r:not-uuid' }] }),
                    msgIncludes: 'malformed userRef',
                },
            ];

            for (const f of failures) {
                it(`${f.label} -> restores prior _impersonate`, async () => {
                    ws.impersonateAs(UUID_PRIOR);
                    const submit = sinon.stub(ws, 'submitRequest');
                    f.stub(submit);
                    let err;
                    try {
                        await ws.impersonateAsEmail('whatever@example.com');
                    } catch (e) { err = e; }
                    expect(err).to.be.instanceOf(Error);
                    expect(err.message).to.match(new RegExp(f.msgIncludes));
                    expect(ws._impersonate).to.equal(UUID_PRIOR);
                });
            }
        });

        it('N14: failure-path gen guard - external mutation during failed lookup wins', async () => {
            const submit = sinon.stub(ws, 'submitRequest');
            let rejectLookup;
            submit.returns(new Promise((_, rj) => { rejectLookup = rj; }));

            // Pre-set prior impersonation, snapshot generation through the
            // lookup's entry path.
            ws.impersonateAs(UUID_PRIOR);

            // Launch a lookup that will reject (we control timing).
            const lookupPromise = ws.impersonateAsEmail('switch@example.com');

            // Synchronously between the lookup's snapshot and its failure,
            // the caller picks a different identity. The failure path's
            // restore-on-throw must NOT clobber this with UUID_PRIOR -
            // the generation has moved.
            ws.impersonateAs(UUID_A);
            expect(ws._impersonate).to.equal(UUID_A);

            // Now the lookup fails.
            rejectLookup(new Error('network'));
            let err;
            try { await lookupPromise; } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('network');

            // The caller's explicit choice wins; restore-on-throw was suppressed.
            expect(ws._impersonate).to.equal(UUID_A);
        });

        it('N12: err.email is NON-ENUMERABLE so logger serialisation does not leak PII', async () => {
            sinon.stub(ws, 'submitRequest').resolves({ rows: [] });
            let err;
            try {
                await ws.impersonateAsEmail('alice@example.com');
            } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            // The redacted message must be visible.
            expect(err.message).to.equal('No account found for email a***@example.com');
            // The raw email must be accessible to deliberate callers.
            expect(err.email).to.equal('alice@example.com');
            // BUT must NOT appear in JSON.stringify(err) or util.inspect(err).
            expect(JSON.stringify(err)).to.not.include('alice@example.com');
            expect(require('util').inspect(err)).to.not.include('alice@example.com');
        });

                it('N17 (transport): 401 on the lookup\'s /api/read does not self-deadlock; retry succeeds', async () => {
            ws = constructWithOptions(log, {});
            await ws.initClientOptions();

            let readAttempts = 0;
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === '/oauth2/token') {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                }
                if (uri === '/api/read') {
                    readAttempts++;
                    if (readAttempts === 1) {
                        // Mimic axios 401 shape: isAxiosError + response.status.
                        const err = new Error('Request failed with status code 401');
                        err.isAxiosError = true;
                        err.response = { status: 401, data: {} };
                        return Promise.reject(err);
                    }
                    return Promise.resolve({
                        rows: [{ userRef: 'r:' + UUID_A }]
                    });
                }
                return Promise.resolve('default response');
            });

            const userId = await withTimeout(
                ws.impersonateAsEmail('user@example.com'),
                1000,
                '401-on-lookup retry'
            );

            expect(userId).to.equal(UUID_A);
            expect(readAttempts).to.equal(2);
            expect(ws._impersonate).to.equal(UUID_A);
        });

                it('serialises two in-flight calls; last invocation wins (H9)', async () => {
            const submit = sinon.stub(ws, 'submitRequest');
            let resolveA, resolveB;
            submit.onFirstCall().returns(new Promise((r) => { resolveA = r; }));
            submit.onSecondCall().returns(new Promise((r) => { resolveB = r; }));

            const p1 = ws.impersonateAsEmail('a@example.com');
            const p2 = ws.impersonateAsEmail('b@example.com');

            // Resolve out of order: B finishes first, then A.
            resolveB({ rows: [{ userRef: 'r:' + UUID_B }] });
            resolveA({ rows: [{ userRef: 'r:' + UUID_A }] });

            const [v1, v2] = await Promise.all([p1, p2]);
            expect(v1).to.equal(UUID_A);
            expect(v2).to.equal(UUID_B);
            // Order-of-invocation wins: B was called last, so B wins.
            expect(ws._impersonate).to.equal(UUID_B);
        });

        it('N2: an explicit unsetImpersonate during in-flight lookup discards the lookup result', async () => {
            const submit = sinon.stub(ws, 'submitRequest');
            let resolveLookup;
            submit.returns(new Promise((r) => { resolveLookup = r; }));

            const lookupPromise = ws.impersonateAsEmail('a@example.com');
            // While the lookup is in flight, caller decides to clear.
            ws.unsetImpersonate();

            // Lookup completes after - must NOT re-arm impersonation.
            resolveLookup({ rows: [{ userRef: 'r:' + UUID_A }] });
            await lookupPromise; // resolves successfully but does not write

            expect(ws._impersonate).to.equal(null);
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('N2: an explicit impersonateAs(other) during in-flight lookup wins', async () => {
            const submit = sinon.stub(ws, 'submitRequest');
            let resolveLookup;
            submit.returns(new Promise((r) => { resolveLookup = r; }));

            const lookupPromise = ws.impersonateAsEmail('a@example.com');
            ws.impersonateAs(UUID_PRIOR);

            resolveLookup({ rows: [{ userRef: 'r:' + UUID_A }] });
            await lookupPromise;

            // The explicit caller's UUID survives.
            expect(ws._impersonate).to.equal(UUID_PRIOR);
        });
    });

    describe('impersonateAs (sync)', () => {
        let log;
        let ws;

        beforeEach(() => {
            const http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
        });

        afterEach(() => sinon.restore());

        it('throws TypeError on email-like string (H3)', () => {
            expect(() => ws.impersonateAs('foo@bar.com')).to.throw(
                TypeError, /use impersonateAsEmail/
            );
        });

        it('throws TypeError on empty string', () => {
            expect(() => ws.impersonateAs('')).to.throw(TypeError);
        });

        it('throws TypeError on whitespace-only string', () => {
            expect(() => ws.impersonateAs('   ')).to.throw(TypeError);
        });

        it('throws TypeError on non-string value', () => {
            expect(() => ws.impersonateAs(42)).to.throw(TypeError);
        });

        it('throws TypeError on malformed UUID (M1)', () => {
            expect(() => ws.impersonateAs('not-a-uuid')).to.throw(
                TypeError, /valid UUID/
            );
        });

        it('null clears impersonation', () => {
            ws.impersonateAs(UUID_A);
            ws.impersonateAs(null);
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('undefined also clears impersonation', () => {
            ws.impersonateAs(UUID_A);
            ws.impersonateAs(undefined);
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('unsetImpersonate logs the prior user id', () => {
            ws.impersonateAs(UUID_A);
            log.info.resetHistory();
            ws.unsetImpersonate();
            expect(log.info.calledWith(
                'Cleared impersonation (was user ID %s)', UUID_A
            )).to.equal(true);
        });
    });

    describe('options.client.impersonateAs', () => {
        let log;
        let ws;

        beforeEach(() => {
            log = new stubs.StubLogger();
        });

        afterEach(() => sinon.restore());

        it('treats an @-containing value as an email and resolves lazily on first request', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubTransport(ws); // default: one row with UUID_A

            expect(ws.isImpersonating()).to.equal(false);
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'lazy first request');

            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws._impersonate).to.equal(UUID_A);

            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers['X-IMPERSONATE']).to.equal(UUID_A);
        });

        it('treats a UUID value as a user id (no lookup)', async () => {
            ws = constructWithOptions(log, { impersonateAs: UUID_A });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);

            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal(UUID_A);
            expect(ws._impersonatePendingEmail).to.equal(null);

            const submit = sinon.spy(ws, 'submitRequest');
            await ws.submitRequest('GET', '/api/about');
            // Only the about call, no /api/read for a lookup.
            expect(submit.calledOnce).to.equal(true);
        });

        it('rejects an empty string at construction (M2: TypeError)', async () => {
            ws = constructWithOptions(log, { impersonateAs: '' });
            let err;
            try { await ws.initClientOptions(); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(TypeError);
            expect(err.message).to.match(/non-empty/);
        });

        it('rejects whitespace-only at construction (M2: TypeError)', async () => {
            ws = constructWithOptions(log, { impersonateAs: '   ' });
            let err;
            try { await ws.initClientOptions(); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(TypeError);
        });

        it('does not re-resolve on subsequent requests', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubTransport(ws);

            await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'first');
            await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'second');

            const readCalls = ws._wsRawSubmit.getCalls().filter(
                (c) => c.args[1] === '/api/read'
            );
            expect(readCalls.length).to.equal(1);
        });

        it('retries lazy resolution after a failed lookup', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            let attempts = 0;
            stubTransport(ws, {
                onRead: () => {
                    attempts++;
                    if (attempts === 1) return Promise.reject(new Error('transient'));
                    return null; // default success
                },
            });

            let firstErr;
            try {
                await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'first');
            } catch (e) { firstErr = e; }
            expect(firstErr).to.be.instanceOf(Error);
            expect(firstErr.message).to.equal('transient');
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');
            expect(ws.isImpersonating()).to.equal(false);

            await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'retry');

            expect(attempts).to.equal(2);
            expect(ws._impersonate).to.equal(UUID_A);
        });

        it('unsetImpersonate cancels a pending email resolution', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubTransport(ws);

            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');
            ws.unsetImpersonate();
            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws.isImpersonating()).to.equal(false);

            await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'after unset');

            const readCalls = ws._wsRawSubmit.getCalls().filter(
                (c) => c.args[1] === '/api/read'
            );
            expect(readCalls.length).to.equal(0);
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers).to.not.have.property('X-IMPERSONATE');
        });

        it('impersonateAs(null) clears active impersonation and pending email', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubTransport(ws);

            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');
            ws.impersonateAs(UUID_A);
            expect(ws._impersonate).to.equal(UUID_A);
            ws.impersonateAs(null);
            expect(ws._impersonate).to.equal(null);
            expect(ws._impersonatePendingEmail).to.equal(null);

            await withTimeout(ws.submitRequest('GET', '/api/about'), 1000, 'after clear');

            const readCalls = ws._wsRawSubmit.getCalls().filter(
                (c) => c.args[1] === '/api/read'
            );
            expect(readCalls.length).to.equal(0);
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers).to.not.have.property('X-IMPERSONATE');
        });

        it('N1: parallel first-burst requests share a single lookup; no deadlock (transport-stubbed)', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            let resolveRead;
            stubTransport(ws, {
                onRead: () => new Promise((r) => { resolveRead = r; })
            });

            const p1 = ws.submitRequest('GET', '/api/about');
            const p2 = ws.submitRequest('GET', '/api/about');

            await new Promise((r) => setImmediate(r));
            resolveRead({ rows: [{ userRef: 'r:' + UUID_A }] });

            await withTimeout(Promise.all([p1, p2]), 1000, 'parallel first-burst');

            const readCalls = ws._wsRawSubmit.getCalls().filter(
                (c) => c.args[1] === '/api/read'
            );
            expect(readCalls.length).to.equal(1);

            // The lookup's own /api/read request must carry the bypass flag
            // (so it does not deadlock by joining its own promise).
            // N13: no plain string key leaks into the outgoing config.
            expect('_skipImpersonateJoin' in readCalls[0].args[3]).to.equal(false);
            // N10: the Symbol IS propagated so the 401 retry path can detect it.
            expect(readCalls[0].args[3][SKIP_IMPERSONATE_JOIN]).to.equal(true);
            // Note: _attachReqConfig strips the flag before it reaches the
            // wire; we therefore expect it to be ABSENT on the outgoing config.

            const aboutCalls = ws._wsRawSubmit.getCalls().filter(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCalls.length).to.equal(2);
            for (const c of aboutCalls) {
                expect(c.args[3].headers['X-IMPERSONATE']).to.equal(UUID_A);
            }
        });

        it('N1: direct impersonateAsEmail() does not deadlock (transport-stubbed)', async () => {
            ws = constructWithOptions(log, {});
            await ws.initClientOptions();
            stubTransport(ws);

            const userId = await withTimeout(
                ws.impersonateAsEmail('alice@example.com'),
                1000,
                'direct impersonateAsEmail'
            );

            expect(userId).to.equal(UUID_A);
            expect(ws._impersonate).to.equal(UUID_A);
        });

        it('N1: lazy via constructor option does not deadlock (transport-stubbed)', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubTransport(ws);

            await withTimeout(
                ws.submitRequest('GET', '/api/about'),
                1000,
                'lazy first request'
            );

            expect(ws._impersonate).to.equal(UUID_A);
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers['X-IMPERSONATE']).to.equal(UUID_A);
        });

        it('concurrent retry after a failed first-burst lookup converges on a single retry (no storm)', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            let attempts = 0;
            stubTransport(ws, {
                onRead: () => {
                    attempts++;
                    if (attempts === 1) return Promise.reject(new Error('transient'));
                    return null;
                },
            });

            const settled = await withTimeout(
                Promise.allSettled([
                    ws.submitRequest('GET', '/api/about'),
                    ws.submitRequest('GET', '/api/about'),
                    ws.submitRequest('GET', '/api/about'),
                ]),
                1500,
                'parallel cold-start with retry'
            );

            expect(attempts).to.equal(2);
            expect(ws._impersonate).to.equal(UUID_A);

            const succeeded = settled.filter((s) => s.status === 'fulfilled');
            expect(succeeded.length).to.equal(2);
        });
    });
});
