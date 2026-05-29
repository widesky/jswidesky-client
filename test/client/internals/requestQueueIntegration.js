/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Integration tests for the opt-in request queue: end-to-end through
 * submitRequest, asserting that the queue paces real HTTP dispatches.
 */
'use strict';

const sinon = require('sinon');
const { expect } = require('chai');
const stubs = require('../../stubs');
const { QueueFullError } = require('../../../src/errors');

function makeClient(queueCfg, overrides = {}) {
    const http = new stubs.StubHTTPClient();
    const ws = stubs.getInstance(http, undefined, Object.assign({
        clientOptions: { queue: queueCfg },
    }, overrides));
    // Restore the real _wsRawSubmit so queue wiring is exercised.
    // stubs.getInstance calls http.stubClient(c) which replaces _wsRawSubmit
    // with a sinon spy; deleting the instance property restores the prototype.
    delete ws._wsRawSubmit;
    // Stub getToken so submitRequest skips real auth.
    ws.getToken = sinon.stub().resolves({ access_token: 'tok' });
    return ws;
}

describe('client', () => {
    describe('queue integration', () => {
        it('is a passthrough (no allocation, simultaneous dispatch) when queue is undefined', async () => {
            const http = new stubs.StubHTTPClient();
            const ws = stubs.getInstance(http);  // no queue config
            delete ws._wsRawSubmit;
            ws.getToken = sinon.stub().resolves({ access_token: 'tok' });

            let inFlight = 0;
            let observedMax = 0;
            const release = [];
            ws.axios.get = sinon.stub().callsFake(() => {
                inFlight++;
                if (inFlight > observedMax) observedMax = inFlight;
                return new Promise((resolve) => release.push(() => {
                    inFlight--;
                    resolve({ data: {} });
                }));
            });

            expect(ws._requestQueue).to.equal(null);

            const pendings = [];
            for (let i = 0; i < 10; i++) {
                pendings.push(ws.submitRequest('GET', '/api/about'));
            }
            await new Promise((r) => setImmediate(r));
            expect(observedMax).to.equal(10);  // no throttling

            while (release.length) release.shift()();
            await Promise.all(pendings);
        });

        it('throttles submitRequest by maxConcurrent', async () => {
            const ws = makeClient({ maxConcurrent: 2 });

            let inFlight = 0;
            let observedMax = 0;
            const release = [];
            ws.axios.get = sinon.stub().callsFake(() => {
                inFlight++;
                if (inFlight > observedMax) observedMax = inFlight;
                return new Promise((resolve) => release.push(() => {
                    inFlight--;
                    resolve({ data: {} });
                }));
            });

            const pendings = [];
            for (let i = 0; i < 10; i++) {
                pendings.push(ws.submitRequest('GET', '/api/about'));
            }

            // Allow the queue to fire the first batch.
            await new Promise((r) => setImmediate(r));
            expect(observedMax).to.equal(2);

            // Release everything and drain the queue.
            while (release.length || ws._requestQueue._inFlight > 0 || ws._requestQueue._queue.length > 0) {
                if (release.length) release.shift()();
                await new Promise((r) => setImmediate(r));
            }
            await Promise.all(pendings);
            expect(observedMax).to.equal(2);
        });
        it('composes with client.batch.create: ≤maxConcurrent dispatches, ≥minDelayMs gaps, aggregated result intact', async function () {
            this.timeout(15000);
            // Acceptance criterion: 1000 entities, batchSize 100, maxConcurrent 3,
            // minDelayMs 50 → ≤3 in-flight HTTP at any moment, ≥50ms gap between
            // dispatches, all 10 chunks complete with aggregated success/error
            // reporting intact.
            //
            // parallel: 5 (caller-side concurrency) lets chunks pile up in the
            // queue. Without it, performOpInBatch's default parallel=1 would
            // serialize chunks regardless of maxConcurrent — the cap could not
            // be exercised. Per-chunk 150ms latency keeps chunks overlapping
            // long enough for the cap to actually bind.
            const ws = makeClient({ maxConcurrent: 3, minDelayMs: 50 });

            let inFlight = 0;
            let observedMax = 0;
            const dispatchedAt = [];

            ws.axios.post = sinon.stub().callsFake(() => {
                inFlight++;
                if (inFlight > observedMax) observedMax = inFlight;
                dispatchedAt.push(Date.now());
                return new Promise((resolve) => setTimeout(() => {
                    inFlight--;
                    resolve({ data: { meta: {}, rows: [] } });
                }, 150));
            });

            const entities = [];
            for (let i = 0; i < 1000; i++) {
                entities.push({ id: `r:e${i}`, dis: `Entity ${i}` });
            }

            const result = await ws.batch.create(entities, {
                batchSize: 100,
                parallel: 5,
            });

            // All 10 chunks dispatched and completed.
            expect(dispatchedAt.length).to.equal(10);

            // The queue's maxConcurrent cap held AND was actively exercised
            // (i.e. concurrency reached > 1, proving the test isn't vacuous).
            expect(observedMax).to.be.at.most(3);
            expect(observedMax).to.be.at.least(2);

            // Successive dispatches paced by minDelayMs.
            const totalSpan = dispatchedAt[dispatchedAt.length - 1] - dispatchedAt[0];
            expect(totalSpan).to.be.at.least(9 * 50 - 5);

            // Aggregated success/error reporting intact.
            expect(result).to.have.property('success').that.is.an('array');
            expect(result).to.have.property('errors').that.is.an('array').with.lengthOf(0);
        });

        it('two separate instances each have their own queue (no cross-instance coordination)', async () => {
            // One queue per WideSkyClient instance. Two instances are independent
            // — no shared throttle. Coordination requires reusing one instance.
            const httpA = new stubs.StubHTTPClient();
            const httpB = new stubs.StubHTTPClient();

            const wsA = stubs.getInstance(httpA, undefined, {
                clientOptions: { queue: { maxConcurrent: 1 } },
            });
            const wsB = stubs.getInstance(httpB, undefined, {
                clientOptions: { queue: { maxConcurrent: 1 } },
            });
            delete wsA._wsRawSubmit;
            delete wsB._wsRawSubmit;
            wsA.getToken = sinon.stub().resolves({ access_token: 'tokA' });
            wsB.getToken = sinon.stub().resolves({ access_token: 'tokB' });

            expect(wsA._requestQueue).to.not.equal(wsB._requestQueue);

            // Hog A's queue with a never-settling request.
            wsA.axios.get = sinon.stub().returns(new Promise(() => {}));
            wsA.submitRequest('GET', '/api/slow').catch(() => {});

            // B has its own queue and proceeds independently.
            wsB.axios.get = sinon.stub().resolves({ data: { ok: true } });

            const start = Date.now();
            const got = await wsB.submitRequest('GET', '/api/about');
            const elapsed = Date.now() - start;

            expect(got).to.deep.equal({ ok: true });
            expect(elapsed).to.be.below(100);
        });

        it('rejects with QueueFullError when maxQueueDepth is exceeded through submitRequest', async () => {
            const ws = makeClient({ maxConcurrent: 1, maxQueueDepth: 2 });

            // Never-resolving stub so the first request holds in-flight forever.
            ws.axios.get = sinon.stub().returns(new Promise(() => {}));

            // 1 takes the in-flight slot, 2 and 3 sit in queue (depth 2).
            const inFlightPromise = ws.submitRequest('GET', '/api/1').catch(() => {});
            const queued1Promise = ws.submitRequest('GET', '/api/2').catch(() => {});
            const queued2Promise = ws.submitRequest('GET', '/api/3').catch(() => {});
            await new Promise((r) => setImmediate(r));

            // 4th request must refuse.
            let err;
            try {
                await ws.submitRequest('GET', '/api/4');
            } catch (e) { err = e; }
            expect(err).to.be.an.instanceOf(QueueFullError);
            expect(err.depth).to.equal(2);

            // Cleanup (let pending fire-and-forgets settle on test teardown).
            inFlightPromise; queued1Promise; queued2Promise;
        });

        it('bypasses the queue for /oauth2/token so auth cannot be rejected by backpressure', async () => {
            // Saturate the queue first (using a stubbed getToken so the
            // saturation step doesn't itself trigger an auth call), then call
            // _doLogin / _doRefresh — both of which route through
            // _wsRawSubmit('/oauth2/token', ...) — and assert they succeed
            // despite the queue being at its cap.
            const http = new stubs.StubHTTPClient();
            const ws = stubs.getInstance(http, undefined, {
                clientOptions: { queue: { maxConcurrent: 1, maxQueueDepth: 2 } },
            });
            delete ws._wsRawSubmit;
            ws.getToken = sinon.stub().resolves({ access_token: 'pre-existing' });

            ws.axios.get = sinon.stub().returns(new Promise(() => {}));
            const inFlightP = ws.submitRequest('GET', '/api/1').catch(() => {});
            const q1 = ws.submitRequest('GET', '/api/2').catch(() => {});
            const q2 = ws.submitRequest('GET', '/api/3').catch(() => {});
            await new Promise((r) => setImmediate(r));
            expect(ws._requestQueue._inFlight).to.equal(1);
            expect(ws._requestQueue._queue.length).to.equal(2);

            // axios.post for the /oauth2/token endpoint resolves with a valid
            // token shape. It must NOT be rejected by the saturated queue.
            ws.axios.post = sinon.stub().resolves({
                data: {
                    access_token: 'new-tok',
                    refresh_token: 'new-refresh',
                    expires_in: 3600,
                    token_type: 'Bearer',
                },
            });

            // Drive through _doLogin — the higher-level entry point. This
            // exercises the full chain _doLogin → _wsRawSubmit (with the
            // bypass branch) → axios.post.
            const loginResult = await ws._doLogin();
            expect(loginResult).to.have.property('access_token', 'new-tok');
            expect(ws.axios.post.callCount).to.equal(1);
            expect(ws.axios.post.firstCall.args[0]).to.match(/\/oauth2\/token$/);

            // Also drive _doRefresh — the other entry that hits the auth path
            // — and confirm it likewise bypasses the queue.
            ws._ws_token = loginResult;
            const refreshResult = await ws._doRefresh();
            expect(refreshResult).to.have.property('access_token', 'new-tok');
            expect(ws.axios.post.callCount).to.equal(2);

            // Queue state must be unchanged — both auth calls bypassed it.
            expect(ws._requestQueue._inFlight).to.equal(1);
            expect(ws._requestQueue._queue.length).to.equal(2);

            // Cleanup.
            inFlightP; q1; q2;
        });

        it('401 retry runs within the same queue slot (one queue.add, no QueueFullError risk)', async () => {
            // A request whose token expired while waiting in the queue gets a
            // 401 on dispatch. The SDK retries with a fresh token — and that
            // retry must run within the SAME queue slot, not re-enter the
            // queue. A saturated queue would otherwise reject the retry with
            // QueueFullError (a backpressure failure for a request that just
            // needed a refresh — surprising and incorrect).
            const ws = makeClient({ maxConcurrent: 1, maxQueueDepth: 5 });
            // Pre-stamp _ws_token so the 401-retry branch (which guards on
            // `this._ws_token`) actually activates.
            ws._ws_token = {
                access_token: 'expired-tok',
                refresh_token: 'ref',
                expires_in: 3600,
                token_type: 'Bearer',
            };

            const err401 = new Error('Unauthorized');
            err401.isAxiosError = true;
            err401.response = { status: 401, data: {} };

            ws.axios.get = sinon.stub();
            ws.axios.get.onFirstCall().rejects(err401);
            ws.axios.get.onSecondCall().resolves({ data: { ok: true } });

            const addSpy = sinon.spy(ws._requestQueue, 'add');

            const result = await ws.submitRequest('GET', '/api/test');
            expect(result).to.deep.equal({ ok: true });

            // queue.add was called exactly ONCE — the dispatch + retry both
            // happen inside the function passed to that single add() call.
            expect(addSpy.callCount).to.equal(1);
            // axios.get was called twice: original (401'd) + retry (200).
            expect(ws.axios.get.callCount).to.equal(2);
        });

        it('maxConcurrent is honoured even when an in-flight request is mid-401-retry', async () => {
            // With maxConcurrent: 1, when request A 401s and retries, the
            // queued request B must NOT dispatch alongside A's retry. The
            // slot stays held until A's retry settles; only then does B run.
            const ws = makeClient({ maxConcurrent: 1, maxQueueDepth: 5 });
            ws._ws_token = {
                access_token: 'expired-tok',
                refresh_token: 'ref',
                expires_in: 3600,
                token_type: 'Bearer',
            };

            const err401 = new Error('Unauthorized');
            err401.isAxiosError = true;
            err401.response = { status: 401, data: {} };

            let inFlight = 0;
            let observedMax = 0;
            let aRetryReleased;
            const aRetryHold = new Promise((resolve) => { aRetryReleased = resolve; });
            const eventOrder = [];

            ws.axios.get = sinon.stub().callsFake(async (uri) => {
                inFlight++;
                if (inFlight > observedMax) observedMax = inFlight;
                eventOrder.push(`start:${uri}`);
                try {
                    if (uri.endsWith('/api/A')) {
                        // First call: 401 (triggers retry).
                        if (ws.axios.get.callCount === 1) {
                            throw err401;
                        }
                        // Retry: held open by aRetryHold so we can observe
                        // whether B dispatches alongside it.
                        await aRetryHold;
                        return { data: { which: 'A-retry' } };
                    }
                    if (uri.endsWith('/api/B')) {
                        return { data: { which: 'B' } };
                    }
                } finally {
                    inFlight--;
                    eventOrder.push(`end:${uri}`);
                }
            });

            // Fire A first, then B. With maxConcurrent: 1, A gets the slot
            // and B waits. A's first axios.get rejects with 401 — the slot
            // should STAY held while A retries.
            const pA = ws.submitRequest('GET', '/api/A');
            const pB = ws.submitRequest('GET', '/api/B');

            // Let A enter in-flight, 401, and start its retry (which holds).
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));

            // At this point: A's retry is in-flight (held open). B must NOT
            // have dispatched yet — the queue slot is still A's.
            expect(observedMax).to.equal(1);

            // Release A's retry. Now B can dispatch.
            aRetryReleased();
            const [rA, rB] = await Promise.all([pA, pB]);

            expect(rA).to.deep.equal({ which: 'A-retry' });
            expect(rB).to.deep.equal({ which: 'B' });
            // Across the whole run, in-flight never exceeded 1.
            expect(observedMax).to.equal(1);
            // B's dispatch ended strictly after A's retry finished.
            expect(eventOrder).to.include('end:http://localhost:3000/api/A');
            expect(eventOrder).to.include('start:http://localhost:3000/api/B');
            const aEnd = eventOrder.indexOf('end:http://localhost:3000/api/A');
            const bStart = eventOrder.indexOf('start:http://localhost:3000/api/B');
            expect(aEnd).to.be.below(bStart);
        });
    });
});
