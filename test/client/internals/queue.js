/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for RequestQueue (src/client/queue.js).
 */
'use strict';

const sinon = require('sinon');
const { expect } = require('chai');
const { RequestQueue } = require('../../../src/client/queue');
const { QueueFullError } = require('../../../src/errors');
const stubs = require('../../stubs');

// perToken is handled at the registry layer, not by RequestQueue itself.
// It's included here so the helper mirrors the public schema shape.
function makeOpts(overrides = {}) {
    return Object.assign({
        maxConcurrent: 5,
        minDelayMs: 0,
        maxQueueDepth: 1000,
        perToken: false,
        highWaterPct: 0.8,
        highWaterLogEveryN: 50,
    }, overrides);
}

describe('RequestQueue', () => {
    describe('basic add/resolve', () => {
        it('resolves with the wrapped function result', async () => {
            const q = new RequestQueue(makeOpts(), new stubs.StubLogger());
            const result = await q.add(async () => 42);
            expect(result).to.equal(42);
        });
    });

    describe('minDelayMs spacing', () => {
        it('spaces dispatches by at least minDelayMs', async () => {
            const clock = sinon.useFakeTimers();
            try {
                const q = new RequestQueue(
                    makeOpts({ maxConcurrent: 5, minDelayMs: 50 }),
                    new stubs.StubLogger()
                );

                const dispatchedAt = [];
                const pending = [];
                for (let i = 0; i < 5; i++) {
                    pending.push(q.add(async () => {
                        dispatchedAt.push(Date.now());
                    }));
                }

                // First dispatch is immediate (cold queue).
                await Promise.resolve();
                expect(dispatchedAt).to.deep.equal([0]);

                // Each subsequent dispatch is gated by minDelayMs.
                for (let i = 1; i < 5; i++) {
                    await clock.tickAsync(50);
                }
                await Promise.all(pending);

                expect(dispatchedAt).to.deep.equal([0, 50, 100, 150, 200]);
            } finally {
                clock.restore();
            }
        });
    });

    describe('empty-queue fast path', () => {
        it('dispatches immediately when queue is cold, regardless of minDelayMs', async () => {
            const clock = sinon.useFakeTimers();
            try {
                const q = new RequestQueue(
                    makeOpts({ maxConcurrent: 1, minDelayMs: 1000 }),
                    new stubs.StubLogger()
                );

                let dispatchedAt = null;
                const pending = q.add(async () => {
                    dispatchedAt = Date.now();
                });

                // No tick — the dispatch should happen on the next microtask.
                await Promise.resolve();
                expect(dispatchedAt).to.equal(0);
                await pending;
            } finally {
                clock.restore();
            }
        });
    });

    describe('FIFO ordering', () => {
        it('resolves in enqueue order under maxConcurrent=1', async () => {
            const q = new RequestQueue(makeOpts({ maxConcurrent: 1 }), new stubs.StubLogger());
            const resolveOrder = [];
            const pending = [];
            for (let i = 0; i < 10; i++) {
                pending.push(q.add(async () => { resolveOrder.push(i); }));
            }
            await Promise.all(pending);
            expect(resolveOrder).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        });
    });

    describe('maxQueueDepth refuse', () => {
        it('rejects with QueueFullError when adding past the cap', async () => {
            const q = new RequestQueue(
                makeOpts({ maxConcurrent: 1, maxQueueDepth: 3 }),
                new stubs.StubLogger()
            );

            const release = [];
            const slow = () => new Promise((resolve) => release.push(resolve));

            // Hold the in-flight slot.
            const inFlight = q.add(slow);
            // Fill the queue exactly to its cap (3 waiting).
            const queued1 = q.add(slow);
            const queued2 = q.add(slow);
            const queued3 = q.add(slow);
            // Give the dispatch loop a chance to take one off into _inFlight.
            await Promise.resolve();
            // After the microtask, _inFlight=1 and queue.length=3 (all 3 waiters
            // sit in the queue because maxConcurrent=1 and the slot is held).

            // Next enqueue must refuse.
            let err;
            try { await q.add(slow); } catch (e) { err = e; }

            expect(err).to.be.an.instanceOf(QueueFullError);
            expect(err.name).to.equal('QueueFullError');
            expect(err.depth).to.equal(3);
            expect(err.inFlight).to.equal(1);
            expect(err.message).to.include('Request queue is full');

            // Drain so the test doesn't leave dangling promises.
            // Release items as they become available (each slow fn runs only
            // after the previous one completes, so we must drain iteratively).
            while (release.length > 0 || q._inFlight > 0 || q._queue.length > 0) {
                if (release.length) release.shift()();
                await new Promise((r) => setImmediate(r));
            }
            await Promise.all([inFlight, queued1, queued2, queued3]);
        });
    });

    describe('error isolation', () => {
        it('rejected fn releases its slot and the queue keeps draining', async () => {
            const q = new RequestQueue(
                makeOpts({ maxConcurrent: 1 }),
                new stubs.StubLogger()
            );

            const results = [];
            const settle = (label, p) => p.then(
                (v) => results.push(['ok', label, v]),
                (e) => results.push(['err', label, e.message])
            );

            await Promise.all([
                settle('A', q.add(async () => 'a-ok')),
                settle('B', q.add(async () => { throw new Error('b-boom'); })),
                settle('C', q.add(async () => 'c-ok')),
            ]);

            expect(results).to.deep.equal([
                ['ok',  'A', 'a-ok'],
                ['err', 'B', 'b-boom'],
                ['ok',  'C', 'c-ok'],
            ]);
            expect(q._inFlight).to.equal(0);
        });
    });

    describe('high-water log throttling', () => {
        it('warns at most once per highWaterLogEveryN enqueues past the mark', async () => {
            const warn = sinon.spy();
            const logger = Object.assign(new stubs.StubLogger(), { warn });

            const q = new RequestQueue(
                makeOpts({
                    maxConcurrent: 1,
                    maxQueueDepth: 10,
                    highWaterPct: 0.5,           // high-water mark = 5
                    highWaterLogEveryN: 3,
                }),
                logger
            );

            const release = [];
            const slow = () => new Promise((resolve) => release.push(resolve));

            // Take 1 into in-flight, then 9 into the queue. The high-water
            // check fires when queue.length >= 5 at enqueue time. That first
            // triggers on the 6th waiter (queue length is exactly 5 going in).
            const pendings = [];
            for (let i = 0; i < 10; i++) pendings.push(q.add(slow));
            await Promise.resolve();

            // Enqueues 5, 6, 7, 8, 9 (1-indexed: the 5th, 6th, ... waiter)
            // are at-or-past the mark. With highWaterLogEveryN=3, that's
            // 5 hits → ceil(5/3) = 2 warn calls? No: counter resets after
            // each fire, so hits at queue-depths 5,6,7,8,9 → counter goes
            // 1,2,3(fire→reset),1,2 → exactly 1 warn call.
            expect(warn.callCount).to.equal(1);
            const arg = warn.firstCall.args[0];
            expect(arg).to.have.property('queueDepth');
            expect(arg).to.have.property('maxQueueDepth', 10);
            expect(arg).to.have.property('highWaterMark', 5);

            // Drain iteratively — each slow fn runs only after the previous
            // one completes (maxConcurrent=1), so we release as they arrive.
            while (release.length > 0 || q._inFlight > 0 || q._queue.length > 0) {
                if (release.length) release.shift()();
                await new Promise((r) => setImmediate(r));
            }
            await Promise.all(pendings);
        });
    });

    describe('concurrency cap', () => {
        it('never exceeds maxConcurrent in-flight', async () => {
            const q = new RequestQueue(makeOpts({ maxConcurrent: 2 }), new stubs.StubLogger());
            let inFlight = 0;
            let observedMax = 0;
            const release = [];

            const taskFactory = () => async () => {
                inFlight++;
                if (inFlight > observedMax) observedMax = inFlight;
                await new Promise((resolve) => release.push(resolve));
                inFlight--;
            };

            // Enqueue 10 tasks; each waits for explicit release.
            const pending = [];
            for (let i = 0; i < 10; i++) pending.push(q.add(taskFactory()));

            // Allow microtasks to run so the queue can dispatch the first batch.
            await new Promise((r) => setImmediate(r));
            expect(observedMax).to.equal(2);
            expect(q._inFlight).to.equal(2);
            expect(q._queue.length).to.equal(8);

            // Release them all and ensure the cap held throughout.
            while (release.length || q._queue.length || q._inFlight > 0) {
                if (release.length) release.shift()();
                await new Promise((r) => setImmediate(r));
            }
            await Promise.all(pending);
            expect(observedMax).to.equal(2);
        });
    });

    describe('QUEUE_SCHEMA', () => {
        it('cast of undefined yields undefined (queue disabled)', () => {
            const { QUEUE_SCHEMA } = require('../../../src/client/queue');
            expect(QUEUE_SCHEMA.cast(undefined)).to.equal(undefined);
        });

        it('cast of empty object yields documented defaults', () => {
            const { QUEUE_SCHEMA } = require('../../../src/client/queue');
            const got = QUEUE_SCHEMA.cast({});
            expect(got).to.deep.equal({
                maxConcurrent: 5,
                minDelayMs: 0,
                maxQueueDepth: 1000,
                perToken: false,
                highWaterPct: 0.8,
                highWaterLogEveryN: 50,
            });
        });

        it('rejects maxConcurrent < 1', () => {
            const { QUEUE_SCHEMA } = require('../../../src/client/queue');
            expect(() => QUEUE_SCHEMA.validateSync({ maxConcurrent: 0 })).to.throw();
        });
    });

    describe('login key + registry', () => {
        const {
            makeLoginKey,
            getRequestQueueForLogin,
            _resetQueueRegistry,
        } = require('../../../src/client/queue');

        beforeEach(() => _resetQueueRegistry());

        it('makeLoginKey concatenates baseUri/username/clientId with NUL', () => {
            const key = makeLoginKey({
                baseUri: 'http://a',
                username: 'u',
                clientId: 'c',
            });
            expect(key).to.equal('http://a\x00u\x00c');
        });

        it('handles missing username and clientId', () => {
            const key = makeLoginKey({ baseUri: 'http://a' });
            expect(key).to.equal('http://a\x00\x00');
        });

        it('getRequestQueueForLogin returns the same queue for the same key', () => {
            const opts = makeOpts();
            const q1 = getRequestQueueForLogin('k1', opts, new stubs.StubLogger());
            const q2 = getRequestQueueForLogin('k1', opts, new stubs.StubLogger());
            expect(q1).to.equal(q2);
        });

        it('getRequestQueueForLogin returns distinct queues for distinct keys', () => {
            const opts = makeOpts();
            const q1 = getRequestQueueForLogin('k1', opts, new stubs.StubLogger());
            const q2 = getRequestQueueForLogin('k2', opts, new stubs.StubLogger());
            expect(q1).to.not.equal(q2);
        });

        it('_resetQueueRegistry clears the registry (test helper)', () => {
            const opts = makeOpts();
            const q1 = getRequestQueueForLogin('k1', opts, new stubs.StubLogger());
            _resetQueueRegistry();
            const q2 = getRequestQueueForLogin('k1', opts, new stubs.StubLogger());
            expect(q1).to.not.equal(q2);
        });

        it('warn-logs on config mismatch when a shared queue already exists', () => {
            const warn1 = sinon.spy();
            const logger1 = Object.assign(new stubs.StubLogger(), { warn: warn1 });
            const q1 = getRequestQueueForLogin(
                'k1',
                makeOpts({ maxConcurrent: 5, minDelayMs: 0 }),
                logger1
            );

            const warn2 = sinon.spy();
            const logger2 = Object.assign(new stubs.StubLogger(), { warn: warn2 });
            const q2 = getRequestQueueForLogin(
                'k1',
                makeOpts({ maxConcurrent: 50, minDelayMs: 100 }),
                logger2
            );

            // Existing queue wins (first-writer).
            expect(q2).to.equal(q1);
            // Second caller's logger receives the warning (caller-preferred).
            expect(warn1.callCount).to.equal(0);
            expect(warn2.callCount).to.equal(1);
            const [meta, msg] = warn2.firstCall.args;
            expect(msg).to.include('queue config mismatch');
            expect(meta).to.have.property('loginKey', 'k1');
            expect(meta.mismatched).to.have.property('maxConcurrent')
                .that.deep.equals({ existing: 5, ignored: 50 });
            expect(meta.mismatched).to.have.property('minDelayMs')
                .that.deep.equals({ existing: 0, ignored: 100 });
        });

        it('does not warn when the second caller passes identical config', () => {
            const opts = makeOpts({ maxConcurrent: 5 });
            const warn = sinon.spy();
            const logger = Object.assign(new stubs.StubLogger(), { warn });

            getRequestQueueForLogin('k1', opts, new stubs.StubLogger());
            getRequestQueueForLogin('k1', opts, logger);

            expect(warn.callCount).to.equal(0);
        });
    });

    describe('public-surface export', () => {
        it('QueueFullError is exposed via the package\'s clientErrors', () => {
            const pkg = require('../../../index');
            expect(pkg).to.have.property('clientErrors');
            expect(pkg.clientErrors).to.have.property('QueueFullError');
            expect(pkg.clientErrors.QueueFullError).to.equal(QueueFullError);
            // sanity: instance check works through the public export
            const err = new pkg.clientErrors.QueueFullError('test', { depth: 1, inFlight: 0 });
            expect(err).to.be.an.instanceOf(pkg.clientErrors.QueueFullError);
        });
    });
});
