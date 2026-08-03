/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * CORE-9226 (#178): getToken()'s staleness decision must survive a wrong LOCAL
 * clock.
 *
 * ===========================================================================
 * THE MEASUREMENT THIS FILE ENCODES
 * ===========================================================================
 *
 * Measured 2026-08-02 against the bench apiserver (lpa-e2e, host port 43000),
 * one password grant:
 *
 *     { access_token, refresh_token, token_type: "Bearer",
 *       expires_in: 1786290734743 }
 *
 * `expires_in` is 1.78e12: an ABSOLUTE epoch-MILLISECOND instant (decoding to
 * 2026-08-09T15:52:14.743Z, seven days out), NOT the RFC 6749
 * seconds-until-expiry. This library's own stubs already encode that dialect
 * (`expires_in: Date.now() + n`), and getToken() compares it directly against
 * `Date.now()`.
 *
 * That comparison mixes two different clocks: a SERVER-issued absolute instant
 * against the LOCAL one. It is correct only while the two agree.
 *
 * ===========================================================================
 * WHY THIS IS NOT A THEORETICAL SKEW
 * ===========================================================================
 *
 * The Edge Go device this client runs on is a TRB145, which has NO
 * battery-backed RTC. widesky-edge-go's src/clock/tls-clock-error.js documents
 * the two ordinary ways it boots BEHIND: on a first-ever boot
 * /etc/init.d/sysfixtime winds the clock up only to the FIRMWARE BUILD DATE,
 * and a unit that sat in a warehouse resumes from the last watermark it wrote.
 * Either can be months behind, and /etc/init.d/ntpclient is START=99 -- after
 * our own S97/S98 -- so our services always start on the uncorrected clock.
 *
 * On a clock that is behind, `expires_in < Date.now()` is false for far longer
 * than the token actually lives, so the client never refreshes PROACTIVELY and
 * keeps presenting a token the server has already expired.
 *
 * The REST path absorbs this: dispatchWithRetry (client.js) catches the 401,
 * clears the token and retries once. The SOCKET path does not. publisher.js /
 * control.js classify a rejected handshake with AUTH_REJECTION_RE
 * (/\b40[13]\b|forbidden|unauthori[sz]ed|bad request/i) and an expired token
 * reads there as an auth denial -- so the device parks on what it reports as a
 * CREDENTIAL fault when the actual fault is its clock. That is the same
 * misclassification tls-clock-error.js exists to prevent one layer down.
 *
 * ===========================================================================
 * THE FIX THESE TESTS PIN
 * ===========================================================================
 *
 * The token's LIFETIME is computable entirely from server-side quantities --
 * `expires_in` minus the `Date` header of the very response that carried it --
 * and that lifetime is then anchored to the LOCAL clock at receipt. Both
 * endpoints of the subtraction come from the server, so the result is immune
 * to any constant local offset.
 *
 * When no server time is available the deadline falls back to the raw
 * `expires_in`, i.e. exactly the behaviour before this change. That fallback is
 * what keeps every pre-existing test in this suite green: they all stub
 * `_wsRawSubmit`, which bypasses the axios interceptor that records server
 * time.
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;

/* An arbitrary but fixed server instant, so a failure message is readable. */
const SERVER_NOW = Date.UTC(2026, 7, 2, 16, 0, 0);
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
/* The device believes it is sixty days earlier than it is. */
const SKEW_BEHIND = 60 * 24 * 60 * 60 * 1000;

/**
 * Build a client whose token endpoint answers with an absolute epoch-ms
 * `expires_in`, and which records the server's own clock the way the real
 * axios response interceptor does.
 *
 * @param {Object} opts
 * @param {number} opts.serverNow   the instant the SERVER thinks it is.
 * @param {number} opts.lifetime    the token's true lifetime in ms.
 * @param {boolean} [opts.withServerTime] when false, simulate a response that
 *        carried no usable `Date` header (the pre-change fallback path).
 * @returns {{ws: Object, tokenCalls: Array<string>}}
 */
function clientWithTokenEndpoint(opts) {
    const http = new stubs.StubHTTPClient();
    const ws = getInstance(http);
    const tokenCalls = [];

    ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body) => {
        if (uri !== '/oauth2/token') {
            return Promise.resolve('default response');
        }
        tokenCalls.push(body.grant_type);

        /* The real client records server time from the response's `Date`
         * header inside the axios interceptor, i.e. BEFORE _getTokenSuccess
         * runs. Stubbing _wsRawSubmit bypasses axios, so do it here to keep
         * the ordering faithful. */
        if (opts.withServerTime !== false) {
            ws._noteServerTime(new Date(opts.serverNow).toUTCString());
        }

        return Promise.resolve({
            access_token: WS_ACCESS_TOKEN,
            refresh_token: WS_REFRESH_TOKEN,
            /* absolute epoch ms, as the apiserver actually answers */
            expires_in: opts.serverNow + opts.lifetime
        });
    });

    return { ws, tokenCalls };
}

describe('client', () => {
    describe('getToken clock skew (CORE-9226 #178)', () => {
        let clock;

        afterEach(() => {
            if (clock) {
                clock.restore();
                clock = null;
            }
        });

        it('refreshes an expired token when the LOCAL clock is far behind', async () => {
            /* The device boots believing it is sixty days ago. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW - SKEW_BEHIND,
                shouldAdvanceTime: false
            });

            const { ws, tokenCalls } = clientWithTokenEndpoint({
                serverNow: SERVER_NOW,
                lifetime: SEVEN_DAYS
            });

            await ws.getToken();
            expect(tokenCalls, 'first call must be a password grant')
                .to.eql(['password']);

            /* Eight days pass. The clock is still sixty days behind, but the
             * token's seven-day life has genuinely run out server-side. */
            clock.tick(SEVEN_DAYS + (24 * 60 * 60 * 1000));

            await ws.getToken();

            expect(
                tokenCalls,
                'a token whose lifetime has elapsed must be refreshed even '
                + 'though the local clock never reaches its absolute expiry'
            ).to.eql(['password', 'refresh_token']);
        });

        it('does NOT refresh a token that is still live under a behind clock', async () => {
            clock = sinon.useFakeTimers({
                now: SERVER_NOW - SKEW_BEHIND,
                shouldAdvanceTime: false
            });

            const { ws, tokenCalls } = clientWithTokenEndpoint({
                serverNow: SERVER_NOW,
                lifetime: SEVEN_DAYS
            });

            await ws.getToken();
            /* One day in: six days of life left. */
            clock.tick(24 * 60 * 60 * 1000);
            await ws.getToken();

            expect(tokenCalls, 'a live token must not be re-fetched')
                .to.eql(['password']);
        });

        it('refreshes on lifetime elapse when the clock is CORRECT (unchanged)', async () => {
            clock = sinon.useFakeTimers({
                now: SERVER_NOW,
                shouldAdvanceTime: false
            });

            const { ws, tokenCalls } = clientWithTokenEndpoint({
                serverNow: SERVER_NOW,
                lifetime: SEVEN_DAYS
            });

            await ws.getToken();
            clock.tick(SEVEN_DAYS + 1000);
            await ws.getToken();

            expect(tokenCalls).to.eql(['password', 'refresh_token']);
        });

        it('falls back to the raw expires_in when no server time is available', async () => {
            /* No `Date` header: the deadline must be the absolute expires_in,
             * i.e. precisely the behaviour before this change. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW,
                shouldAdvanceTime: false
            });

            const { ws, tokenCalls } = clientWithTokenEndpoint({
                serverNow: SERVER_NOW,
                lifetime: SEVEN_DAYS,
                withServerTime: false
            });

            await ws.getToken();
            clock.tick(SEVEN_DAYS + 1000);
            await ws.getToken();

            expect(tokenCalls).to.eql(['password', 'refresh_token']);
        });

        it('ignores an unparseable Date header rather than expiring instantly', async () => {
            clock = sinon.useFakeTimers({
                now: SERVER_NOW,
                shouldAdvanceTime: false
            });

            const http = new stubs.StubHTTPClient();
            const ws = getInstance(http);
            const tokenCalls = [];

            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body) => {
                if (uri !== '/oauth2/token') {
                    return Promise.resolve('default response');
                }
                tokenCalls.push(body.grant_type);
                ws._noteServerTime('not a date at all');
                return Promise.resolve({
                    access_token: WS_ACCESS_TOKEN,
                    refresh_token: WS_REFRESH_TOKEN,
                    expires_in: SERVER_NOW + SEVEN_DAYS
                });
            });

            await ws.getToken();
            clock.tick(24 * 60 * 60 * 1000);
            await ws.getToken();

            expect(tokenCalls, 'a junk Date header must not shorten the token')
                .to.eql(['password']);
        });

        it('derives a refreshed deadline from the REFRESH response, never a stale sample', async () => {
            /* Review N2. The login delivers a good `Date`; the refresh seven
             * days later delivers a garbled one. The garbled header must
             * RESET the server-time sample so the new deadline degrades to
             * the raw `expires_in` -- the documented fallback. Keeping the
             * login-era sample instead pairs the NEW token's expiry with the
             * OLD response's clock, inflating the derived lifetime by the
             * sample's age: the deadline overshoots by ~one token life and
             * the device presents a dead token for the whole overshoot,
             * which is the parking failure this feature exists to remove. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW,
                shouldAdvanceTime: false
            });

            const http = new stubs.StubHTTPClient();
            const ws = getInstance(http);
            const tokenCalls = [];

            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body) => {
                if (uri !== '/oauth2/token') {
                    return Promise.resolve('default response');
                }
                tokenCalls.push(body.grant_type);
                if (body.grant_type === 'password') {
                    /* Login: a healthy response, server clock = SERVER_NOW. */
                    ws._noteServerTime(new Date(SERVER_NOW).toUTCString());
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: SERVER_NOW + SEVEN_DAYS
                    });
                }
                /* Refresh: the server has moved on seven days, but its
                 * `Date` header arrives garbled. */
                ws._noteServerTime('garbled by a middlebox');
                return Promise.resolve({
                    access_token: WS_ACCESS_TOKEN,
                    refresh_token: WS_REFRESH_TOKEN,
                    expires_in: SERVER_NOW + (2 * SEVEN_DAYS) + 1000
                });
            });

            await ws.getToken();
            /* Day 7: the first deadline lapses; the refresh runs. */
            clock.tick(SEVEN_DAYS + 1000);
            await ws.getToken();
            expect(tokenCalls).to.eql(['password', 'refresh_token']);

            expect(
                ws._ws_server_time_ms,
                'a garbled Date on a refresh must RESET the sample, not '
                + 'leave the login-era one to be paired with a later token'
            ).to.equal(null);

            /* Day 14: the second token's true life has run out. Under the
             * raw fallback (the clock is correct here) its deadline is its
             * absolute expiry, so this getToken must refresh. Under a
             * stale-sample pairing the deadline would sit ~7 days further
             * out and this call would do nothing. */
            clock.tick(SEVEN_DAYS + 2000);
            await ws.getToken();

            expect(
                tokenCalls,
                'the second refresh must fire at the fallback deadline'
            ).to.eql(['password', 'refresh_token', 'refresh_token']);
        });

        it('does NOT inherit a stale sample on a BEHIND clock', async () => {
            /* Review N2, skewed variant. On a behind clock the raw fallback
             * means NO proactive refresh (the pre-#178 degraded mode; REST
             * heals per-401), while a stale-sample pairing would fire one at
             * an undocumented instant ~14 days after the garbled refresh.
             * Pin the documented degradation: no third grant inside 20 days. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW - SKEW_BEHIND,
                shouldAdvanceTime: false
            });

            const http = new stubs.StubHTTPClient();
            const ws = getInstance(http);
            const tokenCalls = [];

            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body) => {
                if (uri !== '/oauth2/token') {
                    return Promise.resolve('default response');
                }
                tokenCalls.push(body.grant_type);
                if (body.grant_type === 'password') {
                    ws._noteServerTime(new Date(SERVER_NOW).toUTCString());
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: SERVER_NOW + SEVEN_DAYS
                    });
                }
                ws._noteServerTime('garbled by a middlebox');
                return Promise.resolve({
                    access_token: WS_ACCESS_TOKEN,
                    refresh_token: WS_REFRESH_TOKEN,
                    expires_in: SERVER_NOW + (2 * SEVEN_DAYS) + 1000
                });
            });

            await ws.getToken();
            clock.tick(SEVEN_DAYS + 1000);
            await ws.getToken();
            expect(tokenCalls).to.eql(['password', 'refresh_token']);

            clock.tick(20 * 24 * 60 * 60 * 1000);
            await ws.getToken();

            expect(
                tokenCalls,
                'a garbled refresh Date on a behind clock must degrade to '
                + 'the documented raw fallback (no proactive refresh), never '
                + 'to a stale-sample deadline firing at an undocumented '
                + 'instant'
            ).to.eql(['password', 'refresh_token']);
        });
    });
});
