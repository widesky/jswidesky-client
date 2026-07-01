/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for the consumer watch lease auto-renewer (CORE-8664).
 *
 * The renewer re-issues watchSub with the watchId (watchExtend) at half the
 * lease so a socket-style consumer (no watchPoll) keeps its watch alive. HTTP is
 * stubbed; the interval timer is driven with sinon's fake clock.
 */
"use strict";

const stubs = require("../stubs"),
    expect = require("chai").expect,
    sinon = require("sinon"),
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    getInstance = stubs.getInstance;

const ConsumerWatchRenewer = require("../../src/client/watchRenew");
const { parseLeaseMs } = require("../../src/client/watchRenew");

const TEST_POINTS = [
    "00000000-0001-0001-0001-000000000000",
    "00000000-0001-0001-0001-000000000001",
];
const TEST_WATCH_ID = "11111111-aaa1-bbb1-ccc1-222222222222";

describe("Realtime", function () {
    describe("watch lease renewer", function () {
        beforeEach(() => {
            sinon.restore();
        });

        /* ------------------------------------------------------------
         * Lease string parsing
         * ---------------------------------------------------------- */

        describe("parseLeaseMs", function () {
            it("parses n:<num> sec", function () {
                expect(parseLeaseMs("n:120 sec")).to.equal(120000);
            });
            it("parses n:<num> min", function () {
                expect(parseLeaseMs("n:2 min")).to.equal(120000);
            });
            it("parses a bare number as ms", function () {
                expect(parseLeaseMs(5000)).to.equal(5000);
            });
            it("parses a numeric ms string", function () {
                expect(parseLeaseMs("5000")).to.equal(5000);
            });
            it("returns NaN for an unparseable string", function () {
                expect(Number.isNaN(parseLeaseMs("nonsense"))).to.equal(true);
            });
        });

        /* ------------------------------------------------------------
         * Construction
         * ---------------------------------------------------------- */

        describe("construction", function () {
            it("derives renewEveryMs as half the parsed lease by default", function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const renewer = new ConsumerWatchRenewer(ws, {
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "n:120 sec",
                });
                expect(renewer._renewEveryMs).to.equal(60000);
            });

            it("honours an explicit leaseMs and renewFraction", function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const renewer = new ConsumerWatchRenewer(ws, {
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "n:100 sec",
                    leaseMs: 10000,
                    renewFraction: 0.25,
                });
                expect(renewer._renewEveryMs).to.equal(2500);
            });

            it("throws on a non-positive / unparseable lease", function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                expect(() => new ConsumerWatchRenewer(ws, {
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "nonsense",
                })).to.throw(/positive lease/);
            });

            it("is reachable via client.createWatchRenewer", function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const renewer = ws.createWatchRenewer({
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "n:60 sec",
                });
                expect(renewer).to.be.instanceOf(ConsumerWatchRenewer);
            });
        });

        /* ------------------------------------------------------------
         * Renewal via watchExtend (the watchSub-with-watchId form)
         * ---------------------------------------------------------- */

        describe("renew", function () {
            it("re-issues watchSub with the watchId (watchExtend)", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                const renewer = ws.createWatchRenewer({
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "n:120 sec",
                });

                await renewer.renew();

                const subCall = ws._wsRawSubmit
                    .getCalls()
                    .find((c) => c.args[1] === "/api/watchSub");
                expect(subCall, "watchSub re-issued").to.not.equal(undefined);
                /* watchExtend carries the watchId in meta. */
                expect(subCall.args[2].meta.watchId).to.equal(
                    `s:${TEST_WATCH_ID}`);
                expect(subCall.args[2].meta.lease).to.equal("n:120 sec");
                expect(subCall.args[2].rows).to.deep.equal([
                    { id: `r:${TEST_POINTS[0]}` },
                    { id: `r:${TEST_POINTS[1]}` },
                ]);
            });

            it("reports a failed renewal via onError and does not throw", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    return Promise.reject(new Error("watch gone"));
                });

                const errors = [];
                const renewer = ws.createWatchRenewer({
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "n:120 sec",
                    onError: (e) => errors.push(e),
                });

                /* Must not reject. */
                await renewer.renew();

                expect(errors).to.have.length(1);
                expect(errors[0].message).to.equal("watch gone");
            });

            it("coalesces overlapping renew() calls (single in-flight)", async function () {
                let http = new stubs.StubHTTPClient(),
                    log = new stubs.StubLogger(),
                    ws = getInstance(http, log);

                let resolveExtend;
                let extendCalls = 0;
                ws._wsRawSubmit = sinon.spy((method, uri) => {
                    if (uri === "/oauth2/token") {
                        return Promise.resolve({ access_token: WS_ACCESS_TOKEN });
                    }
                    if (uri === "/api/watchSub") {
                        extendCalls += 1;
                        return new Promise((resolve) => {
                            resolveExtend = () => resolve({ meta: {} });
                        });
                    }
                    return Promise.resolve();
                });

                /* Prime the cached token so the first renew() reaches the
                 * watchSub stub deterministically (no lazy token round-trip
                 * interleaving). */
                await ws.getToken();

                const renewer = ws.createWatchRenewer({
                    watchId: TEST_WATCH_ID,
                    pointIds: TEST_POINTS,
                    lease: "n:120 sec",
                });

                /* First renewal is in flight (its watchSub promise never
                 * resolves until we say so). Let it reach the stub. */
                const first = renewer.renew();
                await new Promise((r) => setImmediate(r));
                expect(extendCalls).to.equal(1);

                /* Second call while the first is in flight is a no-op. */
                await renewer.renew();
                expect(extendCalls).to.equal(1);

                resolveExtend();
                await first;
            });
        });

        /* ------------------------------------------------------------
         * Timer lifecycle (fake clock)
         * ---------------------------------------------------------- */

        describe("start / stop", function () {
            it("renews on the half-lease interval until stopped", async function () {
                const clock = sinon.useFakeTimers();
                try {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    let extendCalls = 0;
                    ws._wsRawSubmit = sinon.spy((method, uri) => {
                        if (uri === "/oauth2/token") {
                            return Promise.resolve({
                                access_token: WS_ACCESS_TOKEN });
                        }
                        if (uri === "/api/watchSub") {
                            extendCalls += 1;
                        }
                        return Promise.resolve({ meta: {} });
                    });

                    const renewer = ws.createWatchRenewer({
                        watchId: TEST_WATCH_ID,
                        pointIds: TEST_POINTS,
                        lease: "n:120 sec",
                    });
                    renewer.start();

                    /* No renewal before the first half-lease tick. */
                    await clock.tickAsync(59000);
                    expect(extendCalls).to.equal(0);

                    /* First tick at 60s. */
                    await clock.tickAsync(1000);
                    expect(extendCalls).to.equal(1);

                    /* Second tick at 120s. */
                    await clock.tickAsync(60000);
                    expect(extendCalls).to.equal(2);

                    renewer.stop();
                    await clock.tickAsync(120000);
                    expect(extendCalls).to.equal(2);
                } finally {
                    clock.restore();
                }
            });

            it("start() is idempotent (one timer)", function () {
                const clock = sinon.useFakeTimers();
                try {
                    let http = new stubs.StubHTTPClient(),
                        log = new stubs.StubLogger(),
                        ws = getInstance(http, log);

                    const renewer = ws.createWatchRenewer({
                        watchId: TEST_WATCH_ID,
                        pointIds: TEST_POINTS,
                        lease: "n:60 sec",
                    });
                    renewer.start();
                    const firstTimer = renewer._timer;
                    renewer.start();
                    expect(renewer._timer).to.equal(firstTimer);
                    renewer.stop();
                } finally {
                    clock.restore();
                }
            });
        });
    });
});
