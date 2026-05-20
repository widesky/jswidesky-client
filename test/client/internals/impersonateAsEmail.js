/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for WideSkyClient.impersonateAsEmail
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    getInstance = stubs.getInstance;

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
                { userRef: 'r:abc-123 Some Dis' }
            ]);

            const resolved = await ws.impersonateAsEmail('alice@example.com');

            expect(resolved).to.equal('abc-123');
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('abc-123');
            expect(ws.v2.find.calledOnce).to.equal(true);
            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="alice@example.com"'
            );
            expect(ws.v2.find.firstCall.args[1]).to.equal(1);
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

        it('throws when matched account has no userRef tag', async () => {
            sinon.stub(ws.v2, 'find').resolves([{}]);

            let err;
            try {
                await ws.impersonateAsEmail('noref@example.com');
            } catch (e) {
                err = e;
            }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'Account for noref@example.com has no userRef tag'
            );
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('logs the email-to-userId resolution at info level', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:abc-123 Some Dis' }
            ]);

            await ws.impersonateAsEmail('alice@example.com');

            expect(log.info.calledWith(
                'Resolved impersonation email %s to user ID %s',
                'alice@example.com',
                'abc-123'
            )).to.equal(true);
            expect(log.info.calledWith(
                'Now impersonating as user ID %s',
                'abc-123'
            )).to.equal(true);
        });

        it('escapes double quotes in the email filter', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:abc-123' }
            ]);

            await ws.impersonateAsEmail('foo"bar@example.com');

            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="foo\\"bar@example.com"'
            );
        });
    });

    describe('options.client.impersonateAs', () => {
        let http;
        let log;
        let ws;

        function stubHttp(client) {
            client._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
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

        beforeEach(() => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
        });

        afterEach(() => {
            sinon.restore();
        });

        it('treats an @-containing value as an email and resolves lazily on first request', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);

            expect(ws.isImpersonating()).to.equal(false);
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:resolved-uuid' }
            ]);

            await ws.submitRequest('GET', '/api/about');

            expect(ws.v2.find.calledOnce).to.equal(true);
            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('resolved-uuid');

            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall, 'about call captured').to.not.equal(undefined);
            expect(aboutCall.args[3].headers['X-IMPERSONATE']).to.equal(
                'resolved-uuid'
            );
        });

        it('treats a non-email value as a user id (no lookup)', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'plain-uuid' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);

            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('plain-uuid');
            expect(ws._impersonatePendingEmail).to.equal(null);

            const findSpy = sinon.spy(ws.v2, 'find');
            await ws.submitRequest('GET', '/api/about');
            expect(findSpy.called).to.equal(false);
        });

        it('does not re-resolve on subsequent requests', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:resolved-uuid' }
            ]);

            await ws.submitRequest('GET', '/api/about');
            await ws.submitRequest('GET', '/api/about');

            expect(ws.v2.find.callCount).to.equal(1);
        });

        it('retries lazy resolution after a failed lookup', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);

            const findStub = sinon.stub(ws.v2, 'find');
            findStub.onFirstCall().rejects(new Error('transient lookup failure'));
            findStub.onSecondCall().resolves([{ userRef: 'r:resolved-uuid' }]);

            let firstErr;
            try {
                await ws.submitRequest('GET', '/api/about');
            } catch (e) {
                firstErr = e;
            }
            expect(firstErr).to.be.instanceOf(Error);
            expect(firstErr.message).to.equal('transient lookup failure');
            // Pending must be restored so the next request can retry.
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');
            expect(ws.isImpersonating()).to.equal(false);

            await ws.submitRequest('GET', '/api/about');

            expect(findStub.callCount).to.equal(2);
            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws._impersonate).to.equal('resolved-uuid');
        });

        it('unsetImpersonate cancels a pending email resolution', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);
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
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);
            const findSpy = sinon.spy(ws.v2, 'find');

            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            ws.impersonateAs('explicit-uuid');
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('explicit-uuid');

            ws.impersonateAs(null);

            expect(ws.isImpersonating()).to.equal(false);
            expect(ws._impersonate).to.equal(null);
            expect(ws._impersonatePendingEmail).to.equal(null);

            await ws.submitRequest('GET', '/api/about');
            expect(findSpy.called).to.equal(false);
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall.args[3].headers).to.not.have.property('X-IMPERSONATE');
        });
    });
});
