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
    getInstance = stubs.getInstance;

// A valid v4 UUID used as the resolved user id in successful lookups.
const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID_B = '11111111-2222-4333-8444-555555555555';

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
                access_token: stubs.WS_ACCESS_TOKEN,
                refresh_token: stubs.WS_REFRESH_TOKEN,
                expires_in: Date.now() + 2000
            });
        }
        return Promise.resolve('default response');
    });
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

        afterEach(() => {
            sinon.restore();
        });

        it('resolves and sets the impersonation user id', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:' + UUID_A + ' Alice' }
            ]);

            const resolved = await ws.impersonateAsEmail('alice@example.com');

            expect(resolved).to.equal(UUID_A);
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal(UUID_A);
            expect(ws.v2.find.calledOnce).to.equal(true);
            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="alice@example.com"'
            );
            expect(ws.v2.find.firstCall.args[1]).to.equal(2);
        });

        it('throws when no account matches', async () => {
            sinon.stub(ws.v2, 'find').resolves([]);

            let err;
            try {
                await ws.impersonateAsEmail('missing@example.com');
            } catch (e) {
                err = e;
            }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'No account found for email missing@example.com'
            );
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('throws when more than one account matches (H7)', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:' + UUID_A },
                { userRef: 'r:' + UUID_B }
            ]);

            let err;
            try {
                await ws.impersonateAsEmail('dup@example.com');
            } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'Multiple accounts (2) found for email dup@example.com'
            );
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('throws when matched account has no userRef tag', async () => {
            sinon.stub(ws.v2, 'find').resolves([{}]);

            let err;
            try {
                await ws.impersonateAsEmail('noref@example.com');
            } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'Account for noref@example.com has no userRef tag'
            );
        });

        it('throws when extracted userRef is not a valid UUID (H2)', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:not-a-uuid' }
            ]);

            let err;
            try {
                await ws.impersonateAsEmail('bad@example.com');
            } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'Account for bad@example.com has a malformed userRef (not a UUID): not-a-uuid'
            );
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

        it('logs the email-to-userId mapping at debug (PII)', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:' + UUID_A }
            ]);

            await ws.impersonateAsEmail('alice@example.com');

            expect(log.debug.calledWith(
                'Resolved impersonation email to user ID %s',
                UUID_A
            )).to.equal(true);
            expect(log.info.calledWith(
                'Now impersonating as user ID %s',
                UUID_A
            )).to.equal(true);
            // email itself must never reach info-level logs
            const infoArgs = log.info.getCalls().flatMap((c) => c.args);
            expect(infoArgs.some((a) =>
                typeof a === 'string' && a.includes('alice@example.com')
            )).to.equal(false);
        });

        it('two-pass escape: backslashes then quotes (H1)', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:' + UUID_A }
            ]);

            // Input contains both a backslash and a double quote.
            await ws.impersonateAsEmail('a\\"b@example.com');

            // Backslash first becomes `\\`, then `"` becomes `\"`, so the
            // emitted filter is `account and email=="a\\\\\\"b@example.com"`.
            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="a\\\\\\"b@example.com"'
            );
        });

        it('escapes a bare backslash even when no quote is present (H1)', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:' + UUID_A }
            ]);

            await ws.impersonateAsEmail('a\\b@example.com');

            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="a\\\\b@example.com"'
            );
        });

        it('lookup runs unimpersonated even when caller has active impersonation (H5)', async () => {
            ws.impersonateAs('prior-user-uuid-not-validated-here');
            // Reset because the assertion below tracks state during find.
            const findStub = sinon.stub(ws.v2, 'find');
            let impersonateDuringFind = null;
            findStub.callsFake(() => {
                impersonateDuringFind = ws._impersonate;
                return Promise.resolve([{ userRef: 'r:' + UUID_B }]);
            });

            await ws.impersonateAsEmail('switch@example.com');

            expect(impersonateDuringFind).to.equal(null);
            expect(ws._impersonate).to.equal(UUID_B);
        });

        it('restores prior impersonation on failed lookup (H5)', async () => {
            ws.impersonateAs('prior-user');
            sinon.stub(ws.v2, 'find').rejects(new Error('network down'));

            let err;
            try {
                await ws.impersonateAsEmail('switch@example.com');
            } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('network down');
            expect(ws._impersonate).to.equal('prior-user');
        });

        it('serialises two in-flight calls; last invocation wins (H9)', async () => {
            const findStub = sinon.stub(ws.v2, 'find');
            let resolveA;
            let resolveB;
            findStub.onFirstCall().returns(new Promise((r) => { resolveA = r; }));
            findStub.onSecondCall().returns(new Promise((r) => { resolveB = r; }));

            const p1 = ws.impersonateAsEmail('a@example.com');
            const p2 = ws.impersonateAsEmail('b@example.com');

            // Resolve B first (out of order), then A.
            resolveB([{ userRef: 'r:' + UUID_B }]);
            resolveA([{ userRef: 'r:' + UUID_A }]);

            const [v1, v2] = await Promise.all([p1, p2]);
            expect(v1).to.equal(UUID_A);
            expect(v2).to.equal(UUID_B);
            // After both settle, the last invocation (B) wins.
            expect(ws._impersonate).to.equal(UUID_B);
        });
    });

    describe('impersonateAs (sync)', () => {
        let http;
        let log;
        let ws;

        beforeEach(() => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
        });

        afterEach(() => sinon.restore());

        it('throws TypeError on email-like string (H3)', () => {
            expect(() => ws.impersonateAs('foo@bar.com')).to.throw(
                TypeError,
                /use impersonateAsEmail/
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

        it('null clears impersonation', () => {
            ws.impersonateAs('some-user');
            ws.impersonateAs(null);
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('undefined also clears impersonation', () => {
            ws.impersonateAs('some-user');
            ws.impersonateAs(undefined);
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('unsetImpersonate logs the prior user id', () => {
            ws.impersonateAs('audit-me');
            log.info.resetHistory();
            ws.unsetImpersonate();
            expect(log.info.calledWith(
                'Cleared impersonation (was user ID %s)',
                'audit-me'
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
            stubAuthAndDefaultRequests(ws);

            expect(ws.isImpersonating()).to.equal(false);
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            sinon.stub(ws.v2, 'find').resolves([{ userRef: 'r:' + UUID_A }]);

            await ws.submitRequest('GET', '/api/about');

            expect(ws.v2.find.calledOnce).to.equal(true);
            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws._impersonate).to.equal(UUID_A);

            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers['X-IMPERSONATE']).to.equal(UUID_A);
        });

        it('treats a non-email value as a user id (no lookup)', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'plain-uuid' });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);

            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('plain-uuid');
            expect(ws._impersonatePendingEmail).to.equal(null);

            const findSpy = sinon.spy(ws.v2, 'find');
            await ws.submitRequest('GET', '/api/about');
            expect(findSpy.called).to.equal(false);
        });

        it('rejects an empty string at construction (H6)', async () => {
            ws = constructWithOptions(log, { impersonateAs: '' });
            let err;
            try { await ws.initClientOptions(); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.match(/non-empty/);
        });

        it('rejects whitespace-only at construction (H6)', async () => {
            ws = constructWithOptions(log, { impersonateAs: '   ' });
            let err;
            try { await ws.initClientOptions(); } catch (e) { err = e; }
            expect(err).to.be.instanceOf(Error);
        });

        it('does not re-resolve on subsequent requests', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);
            sinon.stub(ws.v2, 'find').resolves([{ userRef: 'r:' + UUID_A }]);

            await ws.submitRequest('GET', '/api/about');
            await ws.submitRequest('GET', '/api/about');

            expect(ws.v2.find.callCount).to.equal(1);
        });

        it('retries lazy resolution after a failed lookup', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);

            const findStub = sinon.stub(ws.v2, 'find');
            findStub.onFirstCall().rejects(new Error('transient lookup failure'));
            findStub.onSecondCall().resolves([{ userRef: 'r:' + UUID_A }]);

            let firstErr;
            try {
                await ws.submitRequest('GET', '/api/about');
            } catch (e) { firstErr = e; }
            expect(firstErr).to.be.instanceOf(Error);
            expect(firstErr.message).to.equal('transient lookup failure');
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');
            expect(ws.isImpersonating()).to.equal(false);

            await ws.submitRequest('GET', '/api/about');

            expect(findStub.callCount).to.equal(2);
            expect(ws._impersonate).to.equal(UUID_A);
        });

        it('unsetImpersonate cancels a pending email resolution', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);
            const findSpy = sinon.spy(ws.v2, 'find');

            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            ws.unsetImpersonate();

            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws.isImpersonating()).to.equal(false);

            await ws.submitRequest('GET', '/api/about');

            expect(findSpy.called).to.equal(false);
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers).to.not.have.property('X-IMPERSONATE');
        });

        it('impersonateAs(null) clears active impersonation and pending email', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);
            const findSpy = sinon.spy(ws.v2, 'find');

            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            ws.impersonateAs('explicit-uuid');
            expect(ws._impersonate).to.equal('explicit-uuid');

            ws.impersonateAs(null);
            expect(ws._impersonate).to.equal(null);
            expect(ws._impersonatePendingEmail).to.equal(null);

            await ws.submitRequest('GET', '/api/about');
            expect(findSpy.called).to.equal(false);
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers).to.not.have.property('X-IMPERSONATE');
        });

        it('parallel first-burst requests share a single lookup; both get the X-IMPERSONATE header (C1)', async () => {
            ws = constructWithOptions(log, { impersonateAs: 'lazy@example.com' });
            await ws.initClientOptions();
            stubAuthAndDefaultRequests(ws);

            const findStub = sinon.stub(ws.v2, 'find');
            let resolveLookup;
            findStub.returns(new Promise((r) => { resolveLookup = r; }));

            const p1 = ws.submitRequest('GET', '/api/about');
            const p2 = ws.submitRequest('GET', '/api/about');

            // Let both requests reach the lookup-join point before resolving.
            await new Promise((r) => setImmediate(r));
            resolveLookup([{ userRef: 'r:' + UUID_A }]);

            await Promise.all([p1, p2]);

            expect(findStub.callCount).to.equal(1);
            const aboutCalls = ws._wsRawSubmit.getCalls().filter(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCalls.length).to.equal(2);
            for (const c of aboutCalls) {
                expect(c.args[3].headers['X-IMPERSONATE']).to.equal(UUID_A);
            }
        });
    });
});
