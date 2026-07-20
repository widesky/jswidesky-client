/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

/**
 * Consumer watch lease auto-renewer (CORE-8664).
 *
 * A consumer watch has a finite lease. /api/watchPoll renews that lease
 * server-side as a side effect of polling, so a polling consumer never needs to
 * renew explicitly. A socket-style consumer (watchSub + getWatchSocket, no
 * watchPoll) gets NO special lease treatment: its watch expires when the lease
 * lapses even while its socket stays connected. This utility keeps such a watch
 * alive by re-issuing watchSub with the same watchId (the watchExtend form)
 * before the lease expires.
 *
 * It re-issues at half the lease by default so a single missed renewal does not
 * lose the watch. The renewer is fire-and-forget per tick: a failed renewal is
 * reported via the onError callback and retried on the next tick rather than
 * throwing.
 *
 * Usage:
 *
 *   const sub = await client.watchSub(pointIds, "n:120 sec", "my watch");
 *   const watchId = sub.meta.watchId.substring(2); // strip the s: prefix
 *   const renewer = new ConsumerWatchRenewer(client, {
 *       watchId,
 *       pointIds,
 *       lease: "n:120 sec",
 *       leaseMs: 120000
 *   });
 *   renewer.start();
 *   // ... consume pointData over the socket ...
 *   renewer.stop();
 */

/**
 * Request timeout (ms, kai-2 CORE-8790) applied to the watchExtend renewal
 * REST call. See src/client/publisher.js for the half-open-TCP-flow
 * rationale (a dead cellular flow otherwise hangs the await forever). Capped
 * per-instance below a safe fraction of the lease (see the constructor): a
 * renewal that could still be in flight after its own watch has already
 * expired is pointless, since the watch dies first regardless of whether the
 * renewal eventually lands.
 */
const RECOVERY_REQUEST_TIMEOUT_MS = 45000;

class ConsumerWatchRenewer {
    /**
     * @param {WideSkyClient} client  The owning WideSky client.
     * @param {Object} opts
     * @param {string} opts.watchId   The watch id to keep alive (bare, no s:).
     * @param {Array}  opts.pointIds  The watch's point ids (watchExtend resends
     *                                them with the watchId).
     * @param {string} opts.lease     The lease string to renew with, e.g.
     *                                "n:120 sec" (the same value passed to
     *                                watchSub).
     * @param {number} [opts.leaseMs] The lease duration in ms. When omitted it
     *                                is parsed from `lease` (a "n:<num> sec" or
     *                                bare-number-ms form).
     * @param {number} [opts.renewFraction=0.5]  Fraction of the lease at which to
     *                                renew (0.5 = half-lease).
     * @param {Function} [opts.onError]  Called with (err) on a failed renewal.
     */
    constructor(client, opts = {}) {
        this._client = client;
        this.logger = client.logger;

        this.watchId = opts.watchId;
        this.pointIds = Array.isArray(opts.pointIds)
            ? opts.pointIds : [opts.pointIds];
        this.lease = opts.lease;

        const leaseMs = (opts.leaseMs !== undefined)
            ? opts.leaseMs : parseLeaseMs(opts.lease);
        if (!(leaseMs > 0)) {
            throw new Error(
                'ConsumerWatchRenewer requires a positive lease (leaseMs or a '
                + 'parseable lease string).');
        }
        this._leaseMs = leaseMs;

        const fraction = (opts.renewFraction !== undefined)
            ? opts.renewFraction : 0.5;
        this._renewEveryMs = Math.max(1, Math.floor(leaseMs * fraction));

        /* Recovery-request timeout for the watchExtend call itself (kai-2,
         * CORE-8790): a half-open TCP flow otherwise hangs the await
         * forever, and a stuck renewal never retries (the timer's next tick
         * is still renewEveryMs away). CRITICALLY this must stay below the
         * lease it renews: a renewal that could still be in flight after the
         * watch it renews has already expired is pointless, so cap it to
         * 40% of the lease alongside the module ceiling, whichever is
         * smaller. */
        this._renewTimeoutMs = Math.min(
            RECOVERY_REQUEST_TIMEOUT_MS, Math.floor(leaseMs * 0.4));

        this._onError = (typeof opts.onError === 'function')
            ? opts.onError : null;

        this._timer = null;
        this._renewing = false;
    }

    /**
     * Start the renewal timer. Idempotent. The first renewal fires after
     * renewEveryMs (half the lease by default), not immediately, since the watch
     * was just created.
     *
     * @returns {ConsumerWatchRenewer} this (for chaining).
     */
    start() {
        if (this._timer) {
            return this;
        }
        this._timer = setInterval(() => this._tick(), this._renewEveryMs);
        /* Do not let the renewal timer hold the process open on its own. */
        if (typeof this._timer.unref === 'function') {
            this._timer.unref();
        }
        return this;
    }

    /** Stop the renewal timer. Idempotent. */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /**
     * Re-issue watchSub with the watchId (watchExtend) to renew the lease. Public
     * so a caller can force a renewal; the timer calls it too. Errors are
     * reported via onError and swallowed so a transient failure does not stop the
     * timer.
     *
     * @returns {Promise<void>}
     */
    async renew() {
        if (this._renewing) {
            return;
        }
        this._renewing = true;
        try {
            await this._client.watchExtend(
                this.watchId, this.pointIds, this.lease,
                { timeout: this._renewTimeoutMs });
        }
        catch (err) {
            this.logger.warn(err, 'Consumer watch lease renewal failed');
            if (this._onError) {
                this._onError(err);
            }
        }
        finally {
            this._renewing = false;
        }
    }

    /**
     * Timer tick: fire-and-forget a renewal (renew() contains its own error
     * handling, so a rejected promise here is impossible, but guard anyway).
     * @private
     */
    _tick() {
        this.renew().catch(() => { /* renew() already handled it */ });
    }
}

/**
 * Parse a lease string to milliseconds. Accepts the Haystack "n:<num> sec" /
 * "n:<num> min" / "n:<num> ms" forms watchSub takes, a plain numeric-ms string,
 * or a number (already ms). Returns NaN when unparseable.
 *
 * @param {string|number} lease The lease value.
 * @returns {number} The lease in ms, or NaN.
 */
function parseLeaseMs(lease) {
    if (typeof lease === 'number') {
        return lease;
    }
    if (typeof lease !== 'string') {
        return NaN;
    }

    const raw = lease.startsWith('n:') ? lease.slice(2) : lease;
    const match = raw.trim().match(/^([0-9]*\.?[0-9]+)\s*([a-z]*)$/i);
    if (!match) {
        return NaN;
    }

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'ms').toLowerCase();
    switch (unit) {
        case '':
        case 'ms':
            return value;
        case 's':
        case 'sec':
        case 'secs':
        case 'second':
        case 'seconds':
            return value * 1000;
        case 'min':
        case 'mins':
        case 'minute':
        case 'minutes':
            return value * 60000;
        case 'hr':
        case 'hour':
        case 'hours':
            return value * 3600000;
        default:
            return NaN;
    }
}

module.exports = ConsumerWatchRenewer;
module.exports.parseLeaseMs = parseLeaseMs;
module.exports.RECOVERY_REQUEST_TIMEOUT_MS = RECOVERY_REQUEST_TIMEOUT_MS;
