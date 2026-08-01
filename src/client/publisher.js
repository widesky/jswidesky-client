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

/** Initial / ceiling backoff (ms) for socket-loss re-registration retries.
 * The ceiling is 5 min (-lpa.2, was 30 s): these retries ride metered
 * cellular links and each attempt costs a watchPub REST round-trip plus a
 * full TLS + engine.io handshake. */
const RECOVER_BACKOFF_MS = 1000;
const RECOVER_MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Request timeout (ms, kai-2 CORE-8790) applied ONLY to the REST calls the
 * recovery ladder itself issues (watchPub inside _maybeReregister /
 * _recover). A half-open TCP flow (the far end is gone but never sends a
 * RST, common on cellular) otherwise leaves the await hanging forever,
 * wedging the whole recovery loop behind one stuck request. Deliberately NOT
 * the client's global _requestTimeoutMs (client.js, HTTP/2-only, opt-in):
 * that default's blast radius is every request on the client, far broader
 * than this ladder needs. 45 s is generous for a slow-but-alive cellular
 * round trip on a small watchPub payload, yet short enough that a genuinely
 * dead flow does not block a retry-with-backoff loop for an unreasonable
 * stretch.
 */
const RECOVERY_REQUEST_TIMEOUT_MS = 45000;

/**
 * Auth-rejection park (-lpa.2, CORE-8790 hot-loop audit H2): a 401/403-class
 * denial is NOT a transport failure. It is permanent until a human or another
 * service acts (credential rotation, authz propagation), yet socket.io's
 * reconnection and the recovery ladder both used to treat it as transient,
 * producing a measured ~6 MB/h reconnect flap per denied device. Recovery
 * attempts that fail auth now jump STRAIGHT to this parked cadence instead of
 * riding the transient ladder. Each parked attempt still re-reads the client
 * token (_openSocket calls getToken()), so a credential fixed or refreshed
 * while parked re-authenticates on the next attempt: parking slows the loop,
 * it never strands a recovered credential.
 */
const AUTH_PARK_MS = 5 * 60 * 1000;

/** socket.io Manager reconnection pacing (-lpa.2; see _openSocket). */
const RECONNECTION_DELAY_MS = 5000;
const RECONNECTION_DELAY_MAX_MS = 5 * 60 * 1000;
const RECONNECTION_JITTER = 0.5;

/**
 * The auth-rejection shapes this stack produces: the apiserver's publisher /
 * control namespaces emit a `connection_error` with 'Bad request' (invalid /
 * unresolvable token) or 'Forbidden' (owner mismatch) and then disconnect;
 * HTTP-level handshake denials surface as 401/403 codes in the reason.
 * Deliberately does NOT match 'Watch no longer active' (dead namespace: the
 * re-register path owns it) or transport reasons.
 */
const AUTH_REJECTION_RE = /\b40[13]\b|forbidden|unauthori[sz]ed|bad request/i;

/**
 * Classify a socket rejection reason (string or Error) as an auth denial.
 * @param {*} reason The connect_error / connection_error reason.
 * @returns {boolean} true when the reason is 401/403-shaped.
 */
function isAuthRejection(reason) {
    const msg = (reason && reason.message !== undefined)
        ? reason.message : reason;
    return (typeof msg === 'string') && AUTH_REJECTION_RE.test(msg);
}

/**
 * Equal-jitter delay: half fixed, half random, so a fleet knocked over by one
 * server event does not retry in lockstep (-lpa.2, org backoff policy).
 * @param {number} ms The un-jittered delay.
 * @returns {number} A delay in [ms/2, ms].
 */
function jitteredMs(ms) {
    return Math.round(ms / 2 + Math.random() * (ms / 2));
}

/**
 * Grace (ms) granted to socket.io's own reconnection after a plain `disconnect`
 * before the session forces a fresh re-registration. A transient transport drop
 * that the library heals with a rejoin (re-fires `connect`) cancels the pending
 * recovery within this window, so a within-grace reconnect still needs no REST.
 */
const RECOVER_DISCONNECT_GRACE_MS = 1000;

/** Promise-based sleep. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait for a server acknowledgement of a pointUpdate frame before
 * reporting it UNCONFIRMED (CORE-9226 #159).
 *
 * It is a liveness deadline and nothing else: it exists so an awaiting caller
 * cannot be parked for ever on an answer that is not coming, and it says
 * absolutely nothing about why the answer did not come.
 *
 * It is deliberately NOT a rollout deadline. An earlier version of this comment
 * called it one, on the reasoning that a server predating the ack never invokes
 * the callback -- and a consumer duly read 'unacked' as "this server is old",
 * stopped asking for acks, and deleted its buffered frames. There is no old
 * server population: nothing ships history over this socket today. A server
 * that does not answer is a BROKEN DEPLOYMENT, and the only safe reading of a
 * missing answer is that the frame is unconfirmed. Keep it.
 */
const ACK_TIMEOUT_MS = 30000;

/** Resolutions of an acknowledged pointUpdate (CORE-9226 #159). */
const ACK_STATUS_ACK = 'ack';
const ACK_STATUS_NACK = 'nack';
/**
 * No answer arrived in time. The frame is UNCONFIRMED -- it may have been
 * stored, it may have died in flight, and this client cannot tell which. It is
 * never a licence to drop the frame.
 */
const ACK_STATUS_UNACKED = 'unacked';

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
 *   - 'authParked'     — a recovery attempt was DENIED (401/403-class:
 *                        'Forbidden' / 'Bad request'); recovery is parked at
 *                        the AUTH_PARK_MS cadence instead of the transient
 *                        ladder. Payload is { reason, retryInMs }. Each parked
 *                        attempt re-reads the client token, so a refreshed
 *                        credential re-authenticates without app action.
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

        /* Optional engine.io perMessageDeflate setting forwarded verbatim to the
         * socket.io connection (e.g. { threshold: 100 } so sub-1KB frames still
         * compress; engine.io-client's default threshold of 1024 leaves them
         * raw). Undefined => engine.io-client default. The caller owns the
         * value; the session is a transparent forwarder. */
        this._perMessageDeflate = options.perMessageDeflate;

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

        /* Detach any previous socket BEFORE opening a new one (-lpa.2). A
         * failed recovery attempt used to overwrite this.socket while the old
         * socket's reconnection loop kept running: every failed attempt
         * leaked one more socket hammering the server forever, the flap
         * amplifier behind the measured ~6 MB/h denial loop. */
        this._detachSocket();

        const sock = this._openSocket(id);
        this.socket = sock;
        this._wireSocket(sock);

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, arg) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                fn(arg);
            };

            const timer = setTimeout(() => {
                finish(reject, new Error(`connect to ${id} timed out`));
            }, timeoutMs);

            sock.once('connect', () => {
                this._connected = true;
                finish(resolve, sock);
            });
            const rejectConnect = (reason) => {
                /* An auth-shaped denial must not leave this socket's own
                 * reconnection ladder running behind the rejected promise:
                 * denial is permanent until credentials/authz change, and the
                 * caller (whose connect() just failed) owns the retry pacing.
                 * A transport-shaped failure keeps the socket so socket.io's
                 * (now slowed, jittered) reconnection can self-heal. */
                if (isAuthRejection(reason)) {
                    this.logger.warn(
                        'Publisher socket to %s denied (auth): %s; stopping '
                        + 'the transport retry ladder', id, reason);
                    this._detachSocket();
                }
                finish(reject, reason);
            };
            sock.once('connect_error', rejectConnect);
            sock.once('connection_error', rejectConnect);

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

        const connectOpts = {
            query: { Authorization: accessToken },
            'force new connection': true,
            autoConnect: false,
            reconnection: true,
            /* Reconnection pacing (-lpa.2, hot-loop audit H2): socket.io's
             * defaults (1 s delay, 5 s ceiling) flap a cellular device hard
             * whenever the server is down or rejecting. Base 5 s, ceiling
             * 5 min, with the default 0.5 randomization so a fleet does not
             * retry in lockstep. */
            reconnectionDelay: RECONNECTION_DELAY_MS,
            reconnectionDelayMax: RECONNECTION_DELAY_MAX_MS,
            randomizationFactor: RECONNECTION_JITTER,
            path: `${subPath}/socket.io`
        };
        if (this._perMessageDeflate !== undefined) {
            connectOpts.perMessageDeflate = this._perMessageDeflate;
        }
        return socket.connect(url, connectOpts);
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
             * than wait out the disconnect grace. _recover detaches this
             * socket (stopping its transport retry ladder) and, on an
             * auth-shaped denial, parks at the AUTH_PARK_MS cadence. */
            this._recover(reason);
        });

        sock.on('connection_error', (reason) => {
            this.emit('connectionError', reason);
            /* An auth-shaped denial ('Bad request' / 'Forbidden') is NOT the
             * dead-namespace signal: an immediate fresh watchPub + connect
             * would be denied the same way, at transport cadence (-lpa.2,
             * hot-loop H2). Route it to recovery, which detaches the socket
             * and parks. */
            if (isAuthRejection(reason)) {
                this._recover(reason);
                return;
            }
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
     * ACKNOWLEDGEMENT (CORE-9226 #159). Pass `opts.ack: true` and this returns
     * a PROMISE that settles when the server has finished persisting the frame:
     *
     *   {status: 'ack',     applied}          the frame is RESOLVED and may be
     *                                         dropped; `applied` counts the
     *                                         entries the server committed, and
     *                                         0 is legitimate (it declined them
     *                                         all, on purpose)
     *   {status: 'nack',    applied, failed}  something went WRONG; failed[]
     *                                         names each bad entry as
     *                                         {id, reason}
     *   {status: 'unacked'}                   no answer within opts.ackTimeoutMs:
     *                                         UNCONFIRMED, never "fine"
     *
     * Without `opts.ack` it emits with exactly two arguments and returns
     * undefined, which is how a CUR frame stays unacknowledged: the next tick
     * supersedes it, so confirming one buys nothing and re-sending a stale one
     * is wrong. That is a statement about cur, not a compatibility switch --
     * a caller publishing HISTORY asks for the ack, always.
     *
     * The promise NEVER rejects and never waits indefinitely; see
     * ACK_TIMEOUT_MS for what 'unacked' does and does not mean.
     *
     * @param {Array}  entries   Per-point entries.
     * @param {Object} [opts]    { ts, his, ack, ackTimeoutMs }.
     * @returns {undefined|Promise<Object>} undefined unless opts.ack is set.
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
         * this the flag is silently dropped and a his frame is cur-only. */
        if (opts.his !== undefined) {
            frame.his = opts.his;
        }

        if (!opts.ack) {
            /* The unacknowledged path, which is what a CUR frame takes. Emitted
             * with exactly two arguments, so socket.io allocates no ack id and
             * the server has nothing to answer. */
            this.socket.emit(MESSAGE_EVENT, frame);
            return undefined;
        }

        return this._emitAcked(frame, opts);
    }

    /**
     * Emit a frame with socket.io's native per-message acknowledgement and
     * settle on whichever of the server's answer or the timeout arrives first
     * (CORE-9226 #159).
     *
     * @param {Object} frame the pointUpdate envelope.
     * @param {Object} opts  { ackTimeoutMs }.
     * @returns {Promise<Object>} always resolves, never rejects.
     */
    _emitAcked(frame, opts) {
        const timeoutMs = (opts.ackTimeoutMs === undefined)
            ? ACK_TIMEOUT_MS : opts.ackTimeoutMs;

        return new Promise((resolve) => {
            /* Whichever arrives first wins and the other becomes a no-op. A
             * late ack landing after the timeout must not re-settle the promise
             * -- the caller has already decided the frame was unacknowledged
             * and re-queued it, and resolving twice would let it act on the
             * same frame under two different verdicts. */
            let settled = false;
            const settle = (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };

            const timer = setTimeout(() => {
                settle({status: ACK_STATUS_UNACKED});
            }, timeoutMs);
            /* Never hold the process open for an ack. */
            if (typeof timer.unref === 'function') {
                timer.unref();
            }

            this.socket.emit(MESSAGE_EVENT, frame, (payload) => {
                /* A server that acks but whose payload is unreadable is treated
                 * as a nack, not as a success: the one thing the caller must
                 * never do on a doubtful answer is drop the frame. */
                if (payload === null || typeof payload !== 'object') {
                    settle({
                        status: ACK_STATUS_NACK,
                        applied: 0,
                        failed: []
                    });
                    return;
                }
                if (payload.ok === true) {
                    settle({
                        status: ACK_STATUS_ACK,
                        applied: payload.applied || 0
                    });
                    return;
                }
                settle({
                    status: ACK_STATUS_NACK,
                    applied: payload.applied || 0,
                    failed: Array.isArray(payload.failed) ? payload.failed : []
                });
            });
        });
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

            const res = await this.watchPub(
                freshBody, { timeout: RECOVERY_REQUEST_TIMEOUT_MS });
            if (this._closed) {
                return;
            }

            await this.connect(res.watchId, { autoReregister: this._autoReregister });
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

        /* Stop the dead socket's reconnection loop so it does not keep hammering
         * the gone namespace alongside the fresh one. */
        this._detachSocket();

        let backoff = RECOVER_BACKOFF_MS;
        try {
            /* Emit INSIDE the guarded try/finally (kai-1, CORE-8790): emit()
             * is synchronous, so a throwing 'recovering' listener used to
             * escape BEFORE this try ran, leaving _recovering stuck true
             * forever (self-recovery permanently, silently disabled). Catch
             * the listener's own throw locally, log it loudly (it is a
             * consumer bug, not hidden), and let the ladder proceed
             * regardless: a buggy listener must not be able to corrupt this
             * session's recovery state. */
            try {
                this.emit('recovering', reason);
            }
            catch (emitErr) {
                this.logger.error(emitErr, 'recovering listener threw');
            }

            for (;;) {
                if (this._closed) {
                    return;
                }

                try {
                    /* Fresh watch: drop the stale watchId so the server
                     * allocates a new watch + namespace rather than 404ing. */
                    const freshBody = Object.assign({}, this._lastPubBody);
                    delete freshBody.watchId;

                    const res = await this.watchPub(
                        freshBody, { timeout: RECOVERY_REQUEST_TIMEOUT_MS });
                    if (this._closed) {
                        return;
                    }

                    await this.connect(res.watchId, {
                        autoReregister: this._autoReregister,
                        autoRecover: this._autoRecover
                    });

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
                    let delay;
                    if (isAuthRejection(err)) {
                        /* Auth denial is permanent until credentials / authz
                         * change: do not ride the transient ladder (-lpa.2).
                         * Park at the capped cadence; each parked attempt
                         * re-reads the token, so a refreshed credential
                         * re-auths on the next pass. Loud on purpose. */
                        delay = jitteredMs(AUTH_PARK_MS);
                        this.logger.error(
                            err,
                            'Publisher recovery DENIED (auth); parked, ' +
                            `next attempt in ${delay} ms`
                        );
                        this.emit('authParked', { reason: err, retryInMs: delay });
                        backoff = AUTH_PARK_MS;
                    }
                    else {
                        /* watchPub or connect failed (apiserver still
                         * settling); back off and try again, jittered. */
                        delay = jitteredMs(backoff);
                        this.logger.warn(
                            err,
                            'Publisher socket-loss recovery not yet accepted; ' +
                            `retrying in ${delay} ms`
                        );
                        backoff = Math.min(backoff * 2, RECOVER_MAX_BACKOFF_MS);
                    }
                    this.emit('reregisterError', err);
                    await sleep(delay);
                }
            }
        }
        finally {
            this._recovering = false;
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
        try {
            sock.removeAllListeners();
            sock.disconnect();
            sock.close();
        }
        catch (err) {
            /* best-effort */
        }
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
// Reconnect / auth-park behaviour surface (-lpa.2), exported so consumers'
// vendor-contract tests can pin it against the installed tarball.
module.exports.isAuthRejection = isAuthRejection;
module.exports.AUTH_PARK_MS = AUTH_PARK_MS;
module.exports.RECONNECTION_DELAY_MS = RECONNECTION_DELAY_MS;
module.exports.RECONNECTION_DELAY_MAX_MS = RECONNECTION_DELAY_MAX_MS;
module.exports.RECOVER_MAX_BACKOFF_MS = RECOVER_MAX_BACKOFF_MS;
module.exports.RECOVERY_REQUEST_TIMEOUT_MS = RECOVERY_REQUEST_TIMEOUT_MS;
/* pointUpdate acknowledgement surface (CORE-9226 #159), exported for the same
 * reason: a consumer branches on these and must pin them against the installed
 * tarball rather than restating the string literals. */
module.exports.ACK_TIMEOUT_MS = ACK_TIMEOUT_MS;
module.exports.ACK_STATUS_ACK = ACK_STATUS_ACK;
module.exports.ACK_STATUS_NACK = ACK_STATUS_NACK;
module.exports.ACK_STATUS_UNACKED = ACK_STATUS_UNACKED;
