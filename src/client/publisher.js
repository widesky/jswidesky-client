/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

/**
 * Realtime cur-ingress publisher (CORE-8664).
 *
 * A PublisherSession models one edge that pushes current ("cur") values into
 * WideSky over a socket.io namespace. The lifecycle mirrors the consumer watch
 * (see WideSkyClient.watchSub / getWatchSocket) but inverts the data flow: the
 * edge registers a publisher watch over REST (watchPub), opens a socket to the
 * returned watchId namespace, and emits pointUpdate frames. The server pushes
 * pointCadence (publish-cadence hints) and pointUpdateError (rejections) back.
 *
 * Cadence is watch-driven server-side (a live consumer watch on a point selects
 * the fast cadence; no watch selects the slow cadence). The publisher only sees
 * the resulting pointCadence hints; it does not drive demand.
 *
 * Wire protocol: docs/design/realtime-publisher.md §5, §7.
 */

const Url = require('url-parse');
const socket = require('socket.io-client');
const EventEmitter = require('events');

/** Socket.io message-event name used for both directions on the namespace. */
const MESSAGE_EVENT = 'message';

/** Initial / ceiling backoff (ms) for socket-loss re-registration retries. */
const RECOVER_BACKOFF_MS = 1000;
const RECOVER_MAX_BACKOFF_MS = 30000;

/**
 * Grace (ms) granted to socket.io's own reconnection after a plain `disconnect`
 * before the session forces a fresh re-registration. A transient transport drop
 * that the library heals with a rejoin (re-fires `connect`) cancels the pending
 * recovery within this window, so a within-grace reconnect still needs no REST.
 */
const RECOVER_DISCONNECT_GRACE_MS = 1000;

/** Promise-based sleep. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Commands carried in the `command` field of a `message` envelope. */
const CMD_POINT_UPDATE = 'pointUpdate';
const CMD_POINT_CADENCE = 'pointCadence';
const CMD_POINT_UPDATE_ERROR = 'pointUpdateError';

/**
 * Reject a watchPub body whose per-point entries use the retired intervalHot /
 * intervalWarm field names. The cadence fields are intervalFast / intervalSlow;
 * the old names are a caller bug, not a tolerated alias, and the server rejects
 * them too (no silent fallback). Failing here gives a clear, local error before
 * the REST round-trip.
 *
 * @param {Object} body The watchPub body.
 * @throws {Error} when any data entry carries intervalHot or intervalWarm.
 */
function assertCadenceFieldNames(body) {
    const data = (body && Array.isArray(body.data)) ? body.data : [];
    for (const entry of data) {
        if (entry && (('intervalHot' in entry) || ('intervalWarm' in entry))) {
            throw new Error(
                'watchPub no longer accepts intervalHot/intervalWarm; use ' +
                'intervalFast/intervalSlow.');
        }
    }
}

/**
 * A realtime publisher session bound to a single watchId namespace.
 *
 * Construct one via {@link WideSkyClient#createPublisher}, then call
 * {@link PublisherSession#watchPub} to register a point set and
 * {@link PublisherSession#connect} to open the socket. Emits:
 *
 *   - 'connect'        — socket.io transport connected (owner socket live).
 *   - 'disconnect'     — socket.io disconnected (reason argument).
 *   - 'pointCadence'   — server publish-cadence hint; payload
 *                        { data:[{id, mode}] } where mode is 'fast' | 'slow'.
 *   - 'pointUpdateError' — typed rejection; payload { err, errorCode }. Codes:
 *                        404 (namespace/ownership), 413 (frame too large),
 *                        409 (watch superseded by a newer registration).
 *   - 'superseded'     — convenience event fired alongside a 409
 *                        pointUpdateError; payload is the error record.
 *   - 'reregister'     — automatic fresh watchPub completed after the namespace
 *                        was found dead; payload is the new watchPub response.
 *                        (Also emitted by socket-loss recovery, alongside
 *                        'reregistered', so existing app handlers resync.)
 *   - 'reregisterError'— automatic re-register failed; payload is the Error.
 *   - 'connectionError'— socket.io connection_error / connect_error (e.g. a
 *                        non-owner socket rejected by the server).
 *   - 'recovering'     — socket-loss recovery has begun (a clean apiserver
 *                        restart presents as a plain disconnect / connect_error,
 *                        not a 404). Payload is the triggering reason. Recovery
 *                        tears the dead socket down and re-registers with a fresh
 *                        watchPub + reconnect, retrying with exponential backoff.
 *   - 'reregistered'   — socket-loss recovery completed: a fresh watchPub +
 *                        reconnect succeeded. Payload is the new watchPub
 *                        response. The app should resend its last-known values.
 *   - 'socketSwap'     — the session replaced its socket with a fresh one (after
 *                        a dead-namespace re-register or a socket-loss recovery).
 *                        Payload is the new socket. A shared ControlSession
 *                        listens for this to rebind its command handler to the
 *                        new socket (the old one is torn down).
 *
 * Socket-loss recovery is ON by default and can be disabled per session via
 * createPublisher() options ({ autoRecover: false }) or per connect()
 * ({ autoRecover: false }). It is idempotent and coalesced, so an app-level
 * recovery layered on top (e.g. the hub gateway's) does not fight it: when the
 * session recovers itself it emits 'reregister'/'reregistered' so the existing
 * app handlers resync rather than each launching a competing watchPub.
 *
 * @fires PublisherSession#connect
 * @fires PublisherSession#disconnect
 * @fires PublisherSession#pointCadence
 * @fires PublisherSession#pointUpdateError
 * @fires PublisherSession#superseded
 * @fires PublisherSession#reregister
 * @fires PublisherSession#reregistered
 * @fires PublisherSession#recovering
 * @fires PublisherSession#connectionError
 * @fires PublisherSession#socketSwap
 */
class PublisherSession extends EventEmitter {
    /**
     * @param {WideSkyClient} client  The owning WideSky client (provides auth,
     *                        baseUri and the REST submitRequest pipeline).
     * @param {Object} [options]       Session options.
     * @param {boolean} [options.autoRecover=true]  Recover from a socket loss
     *                        (clean restart / namespace death) by tearing the
     *                        dead socket down and re-registering with a fresh
     *                        watchPub. Set false to opt out and drive recovery
     *                        externally.
     */
    constructor(client, options = {}) {
        super();
        this._client = client;
        this.logger = client.logger;

        /* watchId of the active publisher watch (null until watchPub). */
        this.watchId = null;

        /* The active socket.io socket (null until connect / after close). */
        this.socket = null;

        /* The last successful watchPub request body. Retained verbatim so a
         * dead-namespace recovery can re-register the SAME point set with a
         * fresh watchPub (design §7.4: after grace the watch is gone, the edge
         * falls back to a fresh watchPub). */
        this._lastPubBody = null;

        /* True once close() has run; suppresses auto-reconnect / re-register. */
        this._closed = false;

        /* In-flight re-register guard so a burst of dead-namespace signals
         * does not launch N parallel watchPubs. */
        this._reregistering = false;

        /* Socket-loss recovery (ON by default). A clean apiserver restart
         * presents as a plain disconnect / connect_error rather than a 404 or
         * connection_error, so the 404-driven _maybeReregister never fires and a
         * raw session would publish into a dead socket forever. This drives a
         * fresh re-registration on those signals instead. */
        this._autoRecover = (options.autoRecover !== false);

        /* True once connect() has opened the first socket; recovery never runs
         * before the first registration. */
        this._connected = false;

        /* True while a socket-loss recovery is in flight, so the burst of
         * disconnect / connect_error events a dead namespace produces coalesces
         * into a single fresh re-registration. */
        this._recovering = false;

        /* Pending grace timer for a plain disconnect: a socket.io rejoin
         * (within-grace reconnect) cancels it before recovery launches. */
        this._recoverTimer = null;
    }

    /* ================================================================
     * REST: watchPub / watchUnpub
     * ============================================================== */

    /**
     * Register (or update) a publisher watch over REST.
     *
     * Three modes (design §5):
     *   1. Fresh           — omit `watchId`; a new watch + watchId is allocated.
     *   2. Referenced update — supply `watchId`; the watch's claim set is
     *                          REPLACED in place and the same watchId returned.
     *                          Points absent from `data` are unpublished.
     *   3. Supersede       — omit `watchId` but include points already claimed
     *                          by the SAME user's prior watch; the old watch is
     *                          released and the points re-claimed here.
     *
     * The returned watchId is stashed on the session so connect()/pointUpdate()
     * default to it, and the request body is retained for dead-namespace
     * recovery (re-register with the same point set).
     *
     * @param {Object}   body                watchPub body.
     * @param {string}   [body.watchId]      Existing watch to update in place
     *                                       (mode 2). Omit for fresh/supersede.
     * @param {Object}   [body.onDisconnect] Per-watch disconnect override
     *                                       { mode, graceMs, curStatus, curErr }.
     * @param {Object}   [body.shortRefs]    Map of short key -> full Haystack
     *                                       ref for compact pointUpdate frames.
     * @param {Array}    body.data           Non-empty array of per-point entries
     *                                       { id, intervalFast, intervalSlow?,
     *                                         curVal?, curStatus?, curErr? }.
     *                                       intervalFast is the in-demand cadence
     *                                       (a live consumer watch holds the
     *                                       point); intervalSlow is the
     *                                       out-of-demand cadence (0 = the
     *                                       publisher sleeps out of demand).
     * @param {Object}   [config={}]         Extra submitRequest() config.
     * @returns {Promise<Object>} The parsed { watchId, data:[...] } response.
     * @throws {Error} when a data entry uses the retired intervalHot /
     *                 intervalWarm field names (the server rejects them; this
     *                 fails the caller fast and locally with a clear message).
     */
    async watchPub(body, config = {}) {
        assertCadenceFieldNames(body);

        const res = await this._client.submitRequest(
            'POST',
            '/api/watchPub',
            body,
            config
        );

        if (res && res.watchId) {
            this.watchId = res.watchId;
            /* Retain the registered set (with the server-assigned watchId folded
             * in) so a referenced-update recovery is possible; for a dead
             * namespace we deliberately drop watchId to force a fresh watch. */
            this._lastPubBody = Object.assign({}, body, { watchId: res.watchId });
        }

        return res;
    }

    /**
     * Release all claims belonging to a publisher watch (design §5).
     *
     * @param {string} [watchId]  Watch to release (default this.watchId).
     * @param {Object} [config={}] Extra submitRequest() config.
     * @returns {Promise<Object>} The (empty) response body.
     */
    async watchUnpub(watchId, config = {}) {
        const id = watchId || this.watchId;
        return this._client.submitRequest(
            'POST',
            '/api/watchUnpub',
            { watchId: id },
            config
        );
    }

    /* ================================================================
     * Socket lifecycle
     * ============================================================== */

    /**
     * Open a socket.io connection to the watch namespace and resolve once the
     * transport reports connected.
     *
     * The handshake carries the access token in the connection query exactly as
     * the consumer watch socket does (WideSkyClient.getWatchSocket): the URL is
     * `<scheme>//<host>/<watchId>`, the token rides in `query.Authorization`,
     * and `path` is `<subPath>/socket.io`. A watchPub must have completed first
     * (it primes the client's cached token via submitRequest), so the token
     * read here is synchronous and already valid.
     *
     * On any reject (timeout / connect_error / connection_error) the freshly
     * opened socket is torn down before the promise settles, so a failed connect
     * never leaves a self-reconnecting (`reconnection: true`) socket orphaned
     * against the server.
     *
     * @param {string} [watchId]      Namespace to connect to (default
     *                                this.watchId, i.e. the last watchPub).
     * @param {Object} [opts]         { timeoutMs=10000, autoReregister=true,
     *                                autoRecover }.
     *                                autoReregister enables dead-namespace
     *                                recovery (a fresh watchPub of the same set)
     *                                when the server rejects the socket because
     *                                the watch/namespace no longer exists.
     *                                autoRecover (defaults to the session
     *                                option) enables socket-loss recovery on a
     *                                plain disconnect / connect_error.
     * @returns {Promise<Object>} The connected socket.io socket.
     */
    connect(watchId, opts = {}) {
        const id = watchId || this.watchId;
        if (!id) {
            return Promise.reject(new Error(
                'connect() requires a watchId; call watchPub() first.'));
        }

        const timeoutMs = (opts.timeoutMs !== undefined) ? opts.timeoutMs : 10000;
        this._autoReregister = (opts.autoReregister !== false);
        if (opts.autoRecover !== undefined) {
            this._autoRecover = (opts.autoRecover !== false);
        }

        this.watchId = id;
        const sock = this._openSocket(id);
        this.socket = sock;
        this._wireSocket(sock);

        return new Promise((resolve, reject) => {
            let settled = false;

            const settle = (fn, arg) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                fn(arg);
            };

            /* Reject path: tear the just-opened socket down BEFORE settling so a
             * failed connect does not leave a `reconnection: true` socket (and
             * its persistent connect_error handler) hammering the server. If a
             * later connect() already replaced this.socket, leave that alone. */
            const rejectWith = (arg) => {
                if (settled) {
                    return;
                }
                this._teardownSocket(sock);
                if (this.socket === sock) {
                    this.socket = null;
                }
                settle(reject, arg);
            };

            const timer = setTimeout(() => {
                rejectWith(new Error(`connect to ${id} timed out`));
            }, timeoutMs);

            sock.once('connect', () => {
                this._connected = true;
                settle(resolve, sock);
            });
            sock.once('connect_error', (reason) => rejectWith(reason));
            sock.once('connection_error', (reason) => rejectWith(reason));

            sock.open();
        });
    }

    /**
     * Build (but do not open) a socket.io socket for the namespace, mirroring
     * WideSkyClient.getWatchSocket's URL/path/query derivation so the publisher
     * handshake is byte-for-byte the consumer handshake.
     *
     * `reconnection` is enabled so a transient transport drop heals itself with
     * a plain socket rejoin (design §7.4: reconnect-within-grace needs no REST).
     *
     * @param {string} watchId The namespace.
     * @returns {Object} An unopened socket.io socket.
     * @private
     */
    _openSocket(watchId) {
        const token = this._client.getToken();
        const accessToken = token.access_token;

        const parsedUrl = new Url(this._client.baseUri);
        const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
        const url = `${baseUrl}/${watchId}`;

        let subPath = '';
        if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
            subPath = parsedUrl.pathname;
        }

        this.logger.debug(
            `Publisher socket baseUrl: "${baseUrl}", subPath: "${subPath}", ` +
            `nsp: "${watchId}"`
        );

        return socket.connect(url, {
            query: { Authorization: accessToken },
            'force new connection': true,
            autoConnect: false,
            reconnection: true,
            path: `${subPath}/socket.io`
        });
    }

    /**
     * Attach inbound event capture and lifecycle handlers to a socket.
     *
     * pointCadence / pointUpdateError arrive both as named socket.io events and,
     * defensively, inside the generic `message` envelope (the server emits the
     * named form; the envelope form is handled belt-and-braces).
     *
     * @param {Object} sock The socket.io socket.
     * @private
     */
    _wireSocket(sock) {
        sock.on('connect', () => {
            /* A rejoin (socket.io healed a transient drop within grace) cancels a
             * pending disconnect-driven recovery so no REST round-trip happens. */
            this._connected = true;
            this._cancelPendingRecovery();
            this.emit('connect');
        });

        sock.on('disconnect', (reason) => {
            this.emit('disconnect', reason);
            /* A clean apiserver restart surfaces as a plain disconnect, not a
             * 404 or connection_error. Give socket.io's own reconnection a grace
             * window to rejoin (a within-grace rejoin re-fires 'connect' and
             * cancels this); if it does not, force a fresh re-registration. */
            this._scheduleRecovery(reason);
        });

        sock.on('connect_error', (reason) => {
            this.emit('connectionError', reason);
            /* A failed reconnection attempt against a namespace that no longer
             * exists (post-restart) is a dead-socket signal. Recover now rather
             * than wait out the disconnect grace. */
            this._recover(reason);
        });

        sock.on('connection_error', (reason) => {
            this.emit('connectionError', reason);
            /* A connection_error after the namespace went away (post-grace) is
             * the dead-namespace signal: fall back to a fresh watchPub. */
            this._maybeReregister(reason);
        });

        sock.on(CMD_POINT_CADENCE, (payload) => this._handleCadence(payload));
        sock.on(CMD_POINT_UPDATE_ERROR, (payload) => this._handleError(payload));

        sock.on(MESSAGE_EVENT, (payload) => {
            if (!payload || typeof payload !== 'object') {
                return;
            }
            if (payload.command === CMD_POINT_CADENCE) {
                this._handleCadence(payload);
            }
            else if (payload.command === CMD_POINT_UPDATE_ERROR) {
                this._handleError(payload);
            }
        });
    }

    _handleCadence(payload) {
        this.emit('pointCadence', payload);
    }

    _handleError(payload) {
        const record = {
            err: payload ? payload.err : undefined,
            errorCode: payload ? payload.errorCode : undefined
        };
        this.emit('pointUpdateError', record);

        if (record.errorCode === 409) {
            /* Supersede: another, newer registration for this user stole the
             * claims. Surface a dedicated event so callers can re-register if
             * the supersession was not their own doing. */
            this.emit('superseded', record);
        }
        else if (record.errorCode === 404) {
            /* The namespace no longer maps to an active publisher watch owned by
             * this user (grace expired / restart). Attempt a fresh re-register
             * of the same point set. */
            this._maybeReregister(record);
        }
    }

    /* ================================================================
     * Outbound pointUpdate
     * ============================================================== */

    /**
     * Emit a pointUpdate frame (design §5 / §7.2).
     *
     * Each entry is { id, curVal?, curStatus?, curErr?, ts? } where `id` is a
     * bare Haystack ref/uuid OR a short key registered in the watchPub
     * shortRefs map (compact form). Entry shapes:
     *
     *   - id + curVal (and/or curStatus/curErr): normal value update.
     *   - id only (no curVal/curStatus/curErr): no-op; accepted and ignored
     *     server-side (a reserved, non-malformed shape).
     *
     * Empty `data` is a silent server-side no-op. An optional message-level `ts`
     * is applied to entries that omit their own per-point `ts` (precedence:
     * per-point ts > message ts > server receipt time).
     *
     * @param {Array}  entries   Per-point entries.
     * @param {Object} [opts]    { ts, his } optional message-level timestamp and
     *                           historise flag.
     * @param {string} [opts.ts] Message-level timestamp applied to entries that
     *                           omit their own per-point ts.
     * @param {boolean} [opts.his] When true, the server ALSO persists each
     *                           entry's value to history at its effective ts
     *                           (frame-level, design §7.2): the client decides
     *                           per frame, independent of the point's own `his`
     *                           marker tag. Omitted/false is a cur-only update
     *                           (the default; pointUpdate never historises unless
     *                           the caller opts in). Mirrors the apiserver
     *                           socketDispatch handler, which historises only
     *                           when the inbound frame carries his === true.
     */
    pointUpdate(entries, opts = {}) {
        if (!this.socket) {
            throw new Error('pointUpdate called before connect().');
        }

        const frame = {
            command: CMD_POINT_UPDATE,
            data: Array.isArray(entries) ? entries : [entries]
        };
        if (opts.ts !== undefined) {
            frame.ts = opts.ts;
        }
        /* Forward the frame-level historise flag so the server persists each
         * sample to history (his:true) in addition to the cur update. Without
         * this the flag is omitted and the frame is cur-only. Gated so an
         * unset his never appears on the wire (the server tests his === true). */
        if (opts.his !== undefined) {
            frame.his = opts.his;
        }

        this.socket.emit(MESSAGE_EVENT, frame);
    }

    /* ================================================================
     * Dead-namespace recovery
     * ============================================================== */

    /**
     * Re-register the retained point set with a FRESH watchPub when the server
     * tells us the namespace is dead (post-grace 404, or a connection_error on
     * a namespace that no longer exists). The watchId is dropped from the body
     * so the server allocates a new watch rather than 404ing on the stale id
     * (design §7.4). On success the new socket is opened and a 'reregister'
     * event is emitted; on failure 'reregisterError' is emitted.
     *
     * Guarded so concurrent dead-namespace signals coalesce into one attempt.
     *
     * @param {*} cause The triggering error record / reason (for logging).
     * @private
     */
    async _maybeReregister(cause) {
        if (this._closed || !this._autoReregister) {
            return;
        }
        if (this._reregistering || this._recovering) {
            return;
        }
        if (!this._lastPubBody) {
            return;
        }

        this._reregistering = true;
        try {
            /* Tear the dead socket down before re-registering so its automatic
             * reconnection loop does not keep hammering the gone namespace. */
            this._detachSocket();

            /* Fresh watch: no watchId in the body. */
            const freshBody = Object.assign({}, this._lastPubBody);
            delete freshBody.watchId;

            const res = await this.watchPub(freshBody);
            if (this._closed) {
                return;
            }

            await this.connect(res.watchId, { autoReregister: this._autoReregister });
            /* The socket was replaced; let a shared ControlSession rebind. */
            this._emitSocketSwap();
            this.emit('reregister', res);
        }
        catch (err) {
            this.logger.warn(err, 'Publisher re-register after dead namespace failed');
            this.emit('reregisterError', err);
        }
        finally {
            this._reregistering = false;
        }
    }

    /* ================================================================
     * Socket-loss recovery
     * ============================================================== */

    /**
     * Schedule a socket-loss recovery after a plain `disconnect`, deferred by a
     * grace window so socket.io's own reconnection can heal a transient drop
     * first (a within-grace rejoin re-fires `connect`, which cancels this). A
     * clean apiserver restart never rejoins (the namespace is gone), so once the
     * grace lapses the recovery forces a fresh re-registration.
     *
     * @param {*} reason The disconnect reason (for logging / the event payload).
     * @private
     */
    _scheduleRecovery(reason) {
        if (this._closed || !this._autoRecover || !this._connected) {
            return;
        }
        if (this._recovering || this._recoverTimer) {
            return;
        }
        this._recoverTimer = setTimeout(() => {
            this._recoverTimer = null;
            this._recover(reason);
        }, RECOVER_DISCONNECT_GRACE_MS);
        /* Do not keep the event loop alive solely for the grace timer. */
        if (typeof this._recoverTimer.unref === 'function') {
            this._recoverTimer.unref();
        }
    }

    /**
     * Cancel a pending disconnect-grace recovery timer (a rejoin healed the
     * drop, or the session is closing).
     * @private
     */
    _cancelPendingRecovery() {
        if (this._recoverTimer) {
            clearTimeout(this._recoverTimer);
            this._recoverTimer = null;
        }
    }

    /**
     * Force a fresh re-registration after a socket loss that the 404 / dead-
     * namespace path will not catch (a clean restart presents as a plain
     * disconnect / connect_error). Tears the dead socket down, drops the stale
     * watchId, then re-runs registration as if from cold (fresh watchPub +
     * connect) and re-emits the watchPub response so the app resends its last-
     * known values.
     *
     * Coalesced via `_recovering` (and the dead-namespace `_reregistering`
     * guard) so the burst of disconnect / connect_error events a dead namespace
     * produces launches one recovery, not many. Retries with exponential backoff
     * until watchPub is accepted: an apiserver coming back from a restart can
     * refuse watchPub for a while, and once the dead socket is detached there is
     * no further server event to re-trigger recovery.
     *
     * @param {*} reason The triggering reason (for logging / the event payload).
     * @private
     */
    async _recover(reason) {
        if (this._closed || !this._autoRecover || !this._connected) {
            return;
        }
        if (this._recovering || this._reregistering) {
            return;
        }
        if (!this._lastPubBody) {
            return;
        }

        this._cancelPendingRecovery();
        this._recovering = true;
        this.emit('recovering', reason);

        /* Stop the dead socket's reconnection loop so it does not keep hammering
         * the gone namespace alongside the fresh one. */
        this._detachSocket();

        let backoff = RECOVER_BACKOFF_MS;
        try {
            for (;;) {
                if (this._closed) {
                    return;
                }

                try {
                    /* Fresh watch: drop the stale watchId so the server
                     * allocates a new watch + namespace rather than 404ing. */
                    const freshBody = Object.assign({}, this._lastPubBody);
                    delete freshBody.watchId;

                    const res = await this.watchPub(freshBody);
                    if (this._closed) {
                        return;
                    }

                    await this.connect(res.watchId, {
                        autoReregister: this._autoReregister,
                        autoRecover: this._autoRecover
                    });

                    /* The socket was replaced; let a shared ControlSession rebind
                     * its command handler to the new socket. */
                    this._emitSocketSwap();

                    /* Re-emit under both names: 'reregistered' is the socket-loss
                     * recovery event; 'reregister' keeps existing app handlers
                     * (e.g. the gateway's snapshot resend) firing so they resync
                     * instead of layering a competing recovery on top. */
                    this.emit('reregister', res);
                    this.emit('reregistered', res);
                    return;
                }
                catch (err) {
                    if (this._closed) {
                        return;
                    }
                    /* watchPub or connect failed (apiserver still settling); back
                     * off and try again. The failed connect() already tore its
                     * own socket down, so no orphaned socket lingers between
                     * iterations. */
                    this.logger.warn(
                        err,
                        'Publisher socket-loss recovery not yet accepted; ' +
                        `retrying in ${backoff} ms`
                    );
                    this.emit('reregisterError', err);
                    await sleep(backoff);
                    backoff = Math.min(backoff * 2, RECOVER_MAX_BACKOFF_MS);
                }
            }
        }
        finally {
            this._recovering = false;
        }
    }

    /**
     * Notify listeners (a shared ControlSession) that the active socket was
     * replaced so they can rebind to `this.socket`. Only fires when a live
     * socket is present.
     * @private
     */
    _emitSocketSwap() {
        if (this.socket) {
            this.emit('socketSwap', this.socket);
        }
    }

    /**
     * Tear down a specific socket: remove its listeners, stop its reconnection
     * loop, and close the transport. Safe to call on an already-closed socket
     * and on a socket that is not (or is no longer) `this.socket`.
     *
     * @param {Object} sock The socket to tear down.
     * @private
     */
    _teardownSocket(sock) {
        if (!sock) {
            return;
        }
        try {
            sock.removeAllListeners();
            sock.disconnect();
            sock.close();
        }
        catch (err) {
            /* best-effort */
        }
    }

    /**
     * Detach and tear down the current socket without emitting a user-facing
     * disconnect (used internally before a re-register). Removes listeners,
     * stops the reconnection loop, and closes the transport.
     * @private
     */
    _detachSocket() {
        const sock = this.socket;
        if (!sock) {
            return;
        }
        this.socket = null;
        this._teardownSocket(sock);
    }

    /* ================================================================
     * Teardown
     * ============================================================== */

    /**
     * Cleanly close the session: stop the socket (no reconnect), drop all
     * listeners and clear retained state so no timers/sockets linger. Optionally
     * release the watch over REST first.
     *
     * @param {Object} [opts] { unpub=false } also issue watchUnpub.
     * @returns {Promise<void>}
     */
    async close(opts = {}) {
        this._closed = true;
        this._autoReregister = false;
        this._autoRecover = false;
        this._cancelPendingRecovery();

        const sock = this.socket;
        this.socket = null;
        if (sock) {
            try {
                sock.removeAllListeners();
                sock.disconnect();
                sock.close();
            }
            catch (err) {
                /* best-effort */
            }
        }

        if (opts.unpub && this.watchId) {
            try {
                await this.watchUnpub(this.watchId);
            }
            catch (err) {
                /* Watch may already be gone (grace expiry / supersede). 404 is
                 * idempotent success for the owner; swallow it. */
            }
        }

        /* Drop user listeners last so any unpub-driven events have fired. */
        this.removeAllListeners();
    }
}

module.exports = PublisherSession;
