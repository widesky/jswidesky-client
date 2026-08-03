/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * CORE-9226 (#178, review N3): the axios response interceptor is the ONLY
 * link between the deadline arithmetic and a real token response, and it is
 * exactly the link every other test in this area bypasses: they stub
 * _wsRawSubmit, so nothing exercises the URL match, the header-name
 * normalisation, or the interceptor-before-_getTokenSuccess ordering.
 *
 * On a CORRECT clock a broken interceptor is invisible. The fallback (raw
 * `expires_in` against Date.now()) and the derived deadline agree whenever
 * the clocks agree, so the unit suite, the bench and a live login all stay
 * green while a skewed device in the field behaves exactly as before the
 * fix. These tests close that hole in software: they drive the REAL axios
 * instance (real interceptor chain, real response-header normalisation)
 * through an injected adapter -- no _wsRawSubmit stub anywhere -- with the
 * local clock held sixty days behind the server's, and assert behaviour
 * only a LIVE interceptor can produce.
 *
 * An adapter is the transport axios itself would call (the seam axios
 * documents for exactly this purpose); everything from axios.post() down to
 * dispatchRequest, interceptors included, is real.
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WideSkyClient = require('../../../src/client/client'),
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN;

/* Mirror tokenClockSkew.js so failures read the same way. */
const SERVER_NOW = Date.UTC(2026, 7, 2, 16, 0, 0);
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
/* The device believes it is sixty days earlier than it is. */
const SKEW_BEHIND = 60 * 24 * 60 * 60 * 1000;

/**
 * Build a WideSkyClient whose axios transport is an injected adapter serving
 * /oauth2/token the way the bench apiserver answers it: an ABSOLUTE epoch-ms
 * `expires_in` and (unless a test withholds it) an RFC 1123 `Date` header.
 * The header is deliberately supplied in wire case ('Date') so the test also
 * covers axios's normalisation of response headers to `.date`.
 *
 * @param {Object} opts
 * @param {function(number): Object} opts.answer given the 1-based sequence
 *        number of this token request, returns { serverNow, lifetime,
 *        omitDate? } describing the response to build.
 * @returns {{ws: Object, grants: Array<string>}} the client plus the
 *        grant_type of every token request the adapter served, in order.
 */
function clientWithRealAxios(opts) {
    const grants = [];

    const adapter = (config) => {
        const url = config.url || '';
        if (!url.includes('/oauth2/token')) {
            return Promise.resolve({
                data: '{}',
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': 'application/json' },
                config,
                request: {}
            });
        }

        /* transformRequest has already run: config.data is the JSON string
         * the wire would carry. */
        const body = JSON.parse(config.data);
        grants.push(body.grant_type);

        const r = opts.answer(grants.length);
        const headers = { 'Content-Type': 'application/json' };
        if (!r.omitDate) {
            headers['Date'] = new Date(r.serverNow).toUTCString();
        }

        return Promise.resolve({
            data: JSON.stringify({
                access_token: WS_ACCESS_TOKEN,
                refresh_token: WS_REFRESH_TOKEN,
                token_type: 'Bearer',
                /* absolute epoch ms, as the apiserver actually answers */
                expires_in: r.serverNow + r.lifetime
            }),
            status: 200,
            statusText: 'OK',
            headers,
            config,
            request: {}
        });
    };

    const ws = new WideSkyClient(
        stubs.WS_URI,
        stubs.WS_USER,
        stubs.WS_PASSWORD,
        stubs.WS_CLIENT_ID,
        stubs.WS_CLIENT_SECRET,
        new stubs.StubLogger(),
        undefined,
        { axios: { adapter } }
    );

    return { ws, grants };
}

describe('client', () => {
    describe('token deadline through the REAL axios path (CORE-9226 #178)', () => {
        let clock;

        afterEach(() => {
            if (clock) {
                clock.restore();
                clock = null;
            }
        });

        it('anchors the deadline locally off a live login response', async () => {
            /* Nothing in this test touches _noteServerTime: only a firing
             * interceptor can have delivered the server clock, so a deadline
             * equal to LOCAL now + lifetime is proof the seam is live. An
             * inert interceptor leaves the raw absolute expiry instead. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW - SKEW_BEHIND,
                shouldAdvanceTime: false
            });

            const { ws, grants } = clientWithRealAxios({
                answer: () => ({ serverNow: SERVER_NOW, lifetime: SEVEN_DAYS })
            });

            await ws.getToken();

            expect(grants).to.eql(['password']);
            expect(
                ws._ws_token_deadline,
                'deadline must be the lifetime anchored at LOCAL receipt, '
                + 'which is only possible if the response interceptor fired'
            ).to.equal((SERVER_NOW - SKEW_BEHIND) + SEVEN_DAYS);
        });

        it('refreshes at lifetime-elapse on a sixty-day-behind clock, end to end', async () => {
            /* The field scenario, with no client internals stubbed at all:
             * the proactive refresh must fire when the token's LIFETIME
             * elapses, long before the local clock ever reaches the token's
             * absolute expiry. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW - SKEW_BEHIND,
                shouldAdvanceTime: false
            });

            const { ws, grants } = clientWithRealAxios({
                /* The server's clock moves between requests, as a real one
                 * does. */
                answer: (n) => ({
                    serverNow: SERVER_NOW + ((n - 1) * (SEVEN_DAYS + 1000)),
                    lifetime: SEVEN_DAYS
                })
            });

            await ws.getToken();
            clock.tick(SEVEN_DAYS + 1000);
            await ws.getToken();

            expect(
                grants,
                'the refresh must fire at lifetime-elapse despite the skew'
            ).to.eql(['password', 'refresh_token']);
        });

        it('degrades a Date-less refresh to the raw fallback, never a stale pairing', async () => {
            /* Review N2, through the real transport. The login response
             * carries a good `Date`; the refresh seven days later carries
             * none. The refreshed token's deadline must be its RAW absolute
             * expiry (the documented no-server-time fallback). Pairing the
             * new expiry with the LOGIN-era sample would inflate the derived
             * lifetime by the sample's age (about one whole token life), and
             * the device would present a dead token for the entire
             * overshoot. Clock CORRECT here so the fallback deadline is
             * reachable and the assertion is behavioural, not just
             * arithmetic. */
            clock = sinon.useFakeTimers({
                now: SERVER_NOW,
                shouldAdvanceTime: false
            });

            const { ws, grants } = clientWithRealAxios({
                answer: (n) => ({
                    serverNow: SERVER_NOW + ((n - 1) * (SEVEN_DAYS + 1000)),
                    lifetime: SEVEN_DAYS,
                    omitDate: n > 1
                })
            });

            await ws.getToken();
            /* Day 7: the first deadline lapses; the refresh runs. */
            clock.tick(SEVEN_DAYS + 1000);
            await ws.getToken();
            expect(grants).to.eql(['password', 'refresh_token']);

            const expiry2 = SERVER_NOW + (SEVEN_DAYS + 1000) + SEVEN_DAYS;
            expect(
                ws._ws_token_deadline,
                'a Date-less refresh must fall back to the raw expiry; '
                + 'pairing it with the login-era sample overshoots by the '
                + 'age of that sample'
            ).to.equal(expiry2);

            /* And the deadline it chose must actually fire: day 14 is past
             * the second token's true life, so the next getToken refreshes. */
            clock.tick(SEVEN_DAYS + 2000);
            await ws.getToken();
            expect(
                grants,
                'the second refresh must fire at the fallback deadline'
            ).to.eql(['password', 'refresh_token', 'refresh_token']);
        });
    });
});
