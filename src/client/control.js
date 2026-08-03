/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

/**
 * Realtime control-command listener (CORE-8664).
 *
 * A ControlSession registers the caller as a control-command LISTENER for a set
 * of points over REST (controlSub), then connects a socket so the server can
 * deliver pointWrite command broadcasts and the listener can reply reportWrite.
 * It raises no publisher demand and receives no point value data — it is the
 * receive-and-respond half of the control path a privileged watcher used to
 * provide.
 *
 * Two transports, chosen by the server per registration:
 *   - standalone: the registration id is its own listener namespace; this
 *     session opens a socket to it (handshake resolves on WideSkyConnected, the
 *     same open handshake the consumer watch socket uses).
 *   - shared: when the same account already holds a publisher watch, controlSub
 *     attaches the registration to that watch's namespace and returns
 *     shared:true with the registration id equal to the publisher watchId. The
 *     publisher's open socket then also carries control frames, so this session
 *     reuses that socket instead of opening its own. Pass the owning
 *     PublisherSession via attachTo() (or createControlListener({ publisher }))
 *     to enable it.
 *
 * Command delivery and reportWrite semantics are identical to the legacy watcher
 * path: a pointWrite arrives as a 'message' frame with command 'pointWrite' and
 * a requestId; the app replies with reportWrite(requestId, data).
 *
 * @fires ControlSession#connect
 * @fires ControlSession#disconnect
 * @fires ControlSession#command
 * @fires ControlSession#connectionError
 * @fires ControlSession#recovering
 * @fires ControlSession#reregister
 * @fires ControlSession#reregistered
 * @fires ControlSession#reregisterError
 */

const Url = require('url-parse');
const socket = require('socket.io-client');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/** Socket.io message-event name used for both directions on the namespace. */
const MESSAGE_EVENT = 'message';

/** Open-handshake event a control-listener namespace emits on accept. */
const CONNECTED_EVENT = 'WideSkyConnected';

/** Control command names carried in the `command` field of a `message` frame. */
const CMD_POINT_WRITE = 'pointWrite';
const CMD_REPORT_WRITE = 'reportWrite';

/** Initial / ceiling backoff (ms) for socket-loss re-registration retries.
 * The ceiling is 5 min (-lpa.2, was 30 s): these retries ride metered
 * cellular links and each attempt costs a controlSub REST round-trip plus a
 * full TLS + engine.io handshake. */
const RECOVER_BACKOFF_MS = 1000;
const RECOVER_MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Request timeout (ms, kai-2 CORE-8790) applied ONLY to the REST calls the
 * recovery ladder itself issues (controlSub inside _resubShared / _recover).
 * See src/client/publisher.js for the full half-open-TCP-flow rationale; the
 * value is duplicated here (not imported) following this file's existing
 * convention for the sibling recovery constants above.
 */
const RECOVERY_REQUEST_TIMEOUT_MS = 45000;

/** Bound on the shared-resub stabilisation loop (-lpa.3): a publisher that
 * swaps watches back-to-back must not spin _resubShared forever. Each pass
 * costs a controlSub round-trip, so a small ceiling is ample for a realistic
 * swap burst; exhausting it logs and defers to the next reregistered event. */
const RESUB_STABILISE_MAX = 8;

/** Auth-rejection park cadence (-lpa.2); see src/client/publisher.js. */
const AUTH_PARK_MS = 5 * 60 * 1000;

/** The auth-rejection reason shapes; see src/client/publisher.js. */
const AUTH_REJECTION_RE = /\b40[13]\b|forbidden|unauthori[sz]ed|bad request/i;

/** socket.io Manager reconnection pacing (-lpa.2; see _openSocket). */
const RECONNECTION_DELAY_MS = 5000;
const RECONNECTION_DELAY_MAX_MS = 5 * 60 * 1000;
const RECONNECTION_JITTER = 0.5;

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
 * Equal-jitter delay: half fixed, half random (-lpa.2 org backoff policy).
 * @param {number} ms The un-jittered delay.
 * @returns {number} A delay in [ms/2, ms].
 */
function jitteredMs(ms) {
    return Math.round(ms / 2 + Math.random() * (ms / 2));
}

/**
 * Grace (ms) granted to socket.io's own reconnection after a plain `disconnect`
 * before the session forces a fresh re-registration. A transient transport drop
 * the library heals with a rejoin (re-fires the open handshake) cancels the
 * pending recovery within this window.
 */
const RECOVER_DISCONNECT_GRACE_MS = 1000;

/** Promise-based sleep. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A realtime control-command listener session.
 *
 * Construct one via {@link WideSkyClient#createControlListener}, then call
 * {@link ControlSession#controlSub} to register a point set and
 * {@link ControlSession#connect} to start receiving commands. Reply to a
 * pointWrite with {@link ControlSession#reportWrite}.
 */
class ControlSession extends EventEmitter {
    /**
     * @param {WideSkyClient} client  The owning WideSky client (provides auth,
     *                        baseUri and the REST submitRequest pipeline).
     * @param {Object} [options]       Session options.
     * @param {PublisherSession} [options.publisher]  An owning publisher session
     *                        whose socket should carry control frames when the
     *                        server returns a shared registration (same account
     *                        holds the publisher watch). Equivalent to a later
     *                        attachTo(publisher).
     * @param {boolean} [options.autoRecover=true]  Recover from a socket loss
     *                        (clean restart / namespace death) by tearing the
     *                        dead socket down and re-registering with a fresh
     *                        controlSub. Set false to opt out.
     */
    constructor(client, options = {}) {
        super();
        this._client = client;
        this.logger = client.logger;

        /* Registration id of the active control registration (null until
         * controlSub). For a shared registration this equals the owning
         * publisher's watchId. */
        this.registrationId = null;

        /* True when the server placed the registration on an owning publisher's
         * namespace (shared transport): no socket of our own is opened. */
        this.shared = false;

        /* The active standalone listener socket (null for the shared transport,
         * and until connect / after close). */
        this.socket = null;

        /* An owning PublisherSession for the shared transport (its socket
         * carries control frames). */
        this._publisher = options.publisher || null;

        /* The last successful controlSub request body, retained verbatim so a
         * dead-namespace recovery can re-register the SAME point set. */
        this._lastSubBody = null;

        /* True once close() has run; suppresses auto-reconnect / re-register. */
        this._closed = false;

        /* Socket-loss recovery (ON by default). */
        this._autoRecover = (options.autoRecover !== false);

        /* True once connect() has run; recovery never runs before the first
         * registration. */
        this._connected = false;

        /* True while a socket-loss recovery is in flight so a burst of
         * disconnect / connect_error events coalesces into one re-registration. */
        this._recovering = false;

        /* Set when a publisher watch swap arrives while a shared resub is
         * already in flight (-lpa.3): the in-flight resub re-checks this on
         * completion and runs again against the live watch rather than
         * stranding the registration on the dead one. */
        this._resubPending = false;

        /* Pending grace timer for a plain disconnect; a within-grace rejoin
         * cancels it. */
        this._recoverTimer = null;

        /* The shared-transport command handler bound to the owning publisher's
         * socket, retained (with the socket OBJECT it was bound to) so it can
         * be detached on close and re-bound after a publisher socket swap
         * without stacking duplicates (-lpa.2). */
        this._sharedHandler = null;
        this._sharedSocket = null;

        /* The 'reregistered' listener bound onto the owning publisher session
         * (-lpa.2): a publisher socket-loss recovery swaps in a fresh socket
         * AND a fresh watch, which kills a shared registration twice over (the
         * command handler is bound to the dead socket object, and the server
         * purged the registration with the superseded watch). This listener
         * re-runs controlSub against the publisher's NEW watch and rebinds the
         * handler to the NEW socket. */
        this._pubReregHandler = null;

        if (this._publisher) {
            this._wirePublisherHooks();
        }
    }

    /* ================================================================
     * Shared transport wiring
     * ============================================================== */

    /**
     * Bind an owning publisher session so a shared control registration reuses
     * its socket. Call before controlSub() (or pass { publisher } to
     * createControlListener). When the server returns shared:true the publisher
     * socket carries pointWrite/reportWrite frames and no listener socket of our
     * own is opened.
     *
     * @param {PublisherSession} publisher The owning publisher session.
     * @returns {ControlSession} this (for chaining).
     */
    attachTo(publisher) {
        this._detachPublisherHooks();
        this._publisher = publisher;
        this._wirePublisherHooks();
        return this;
    }

    /**
     * Subscribe to the owning publisher's 'reregistered' event so a shared
     * registration survives the publisher's socket-loss recovery (-lpa.2; see
     * the constructor comment). Idempotent per publisher.
     * @private
     */
    _wirePublisherHooks() {
        if (!this._publisher || typeof this._publisher.on !== 'function'
                || this._pubReregHandler) {
            return;
        }
        this._pubReregHandler = (res) => {
            this._resubShared(res).catch((err) => {
                /* _resubShared retries internally; a rejection here means it
                 * bailed permanently (session closed). */
                this.logger.debug(err,
                    'shared control re-registration abandoned');
            });
        };
        this._publisher.on('reregistered', this._pubReregHandler);
    }

    /**
     * Drop the 'reregistered' listener off the owning publisher (close /
     * re-attach).
     * @private
     */
    _detachPublisherHooks() {
        if (this._publisher && this._pubReregHandler
                && typeof this._publisher.removeListener === 'function') {
            try {
                this._publisher.removeListener(
                    'reregistered', this._pubReregHandler);
            }
            catch (err) {
                /* best-effort */
            }
        }
        this._pubReregHandler = null;
    }

    /* ================================================================
     * REST: controlSub / controlUnsub
     * ============================================================== */

    /**
     * Register a control listener for a set of points over REST.
     *
     * The body is { data: [{ id }, ...] }; per-point POINT_WRITE is checked
     * server-side and a forbidden / unknown-point status is reported per point
     * (mirroring watchPub). The respond-side CONTROL_EXECUTE permission is
     * enforced when the listener socket joins the command router.
     *
     * The returned registrationId is stashed on the session so connect()
     * defaults to it, and the request body is retained for dead-namespace
     * recovery. The response `shared` flag selects the transport: shared:true
     * means the registration rides an owning publisher's namespace (no socket of
     * our own); otherwise the registration id is a standalone listener namespace.
     *
     * @param {Object} body              controlSub body { data: [{ id }] }, or
     *                                   an array of point ids / entries (wrapped).
     * @param {Object} [config={}]       Extra submitRequest() config.
     * @returns {Promise<Object>} The parsed { registrationId?, shared, data }.
     */
    async controlSub(body, config = {}) {
        const normalised = this._normaliseSubBody(body);

        /* Explicit shared-transport opt-in: when an owning publisher has been
         * bound via attachTo(), name its watchId so the server rides that
         * publisher's open socket (one transport for pointUpdate +
         * pointWrite/reportWrite). Without this signal the server has no
         * per-session fact to key on and defaults to a standalone listener
         * namespace. A caller may also set body.attachTo directly. */
        if (this._publisher && this._publisher.watchId
                && (normalised.attachTo === undefined)) {
            normalised.attachTo = this._publisher.watchId;
        }

        const res = await this._client.submitRequest(
            'POST',
            '/api/controlSub',
            normalised,
            config
        );

        if (res && res.registrationId) {
            this.registrationId = res.registrationId;
            this.shared = (res.shared === true);
            this._lastSubBody = Object.assign({}, normalised);
        }

        return res;
    }

    /**
     * Release the control registration over REST (owner-only). The server raises
     * a 404 for an unknown OR non-owner registration so existence is not
     * disclosed.
     *
     * @param {string} [registrationId]  Registration to release (default the
     *                                   session's own).
     * @param {Object} [config={}]       Extra submitRequest() config.
     * @returns {Promise<Object>} The (empty) response body.
     */
    async controlUnsub(registrationId, config = {}) {
        const id = registrationId || this.registrationId;
        return this._client.submitRequest(
            'POST',
            '/api/controlUnsub',
            { registrationId: id },
            config
        );
    }

    /**
     * Coerce a caller-friendly controlSub argument into the wire body
     * { data: [{ id }] }. Accepts the wire body verbatim, a bare id, an array of
     * ids, or an array of { id } entries.
     *
     * @param {Object|Array|string} body The caller argument.
     * @returns {Object} The wire body.
     * @private
     */
    _normaliseSubBody(body) {
        if (body && !Array.isArray(body) && Array.isArray(body.data)) {
            return body;
        }
        const list = Array.isArray(body) ? body : [body];
        return {
            data: list.map((entry) =>
                (entry && typeof entry === 'object') ? entry : { id: entry })
        };
    }

    /* ================================================================
     * Socket lifecycle
     * ============================================================== */

    /**
     * Start receiving control commands.
     *
     * Shared transport (registration rode an owning publisher's namespace): no
     * socket of our own is opened; the command handler is bound to the
     * publisher's socket and resolves immediately.
     *
     * Standalone transport: a socket.io connection is opened to the registration
     * namespace with the same token handshake the consumer watch socket uses,
     * resolving on the WideSkyConnected open handshake.
     *
     * @param {string} [registrationId]  Namespace to connect to (default the
     *                                   controlSub-assigned id).
     * @param {Object} [opts]            { timeoutMs=10000, autoReregister=true,
     *                                   autoRecover }.
     * @returns {Promise<Object|null>} The connected socket (standalone), or null
     *                                 when the shared transport is used.
     */
    async connect(registrationId, opts = {}) {
        const id = registrationId || this.registrationId;
        if (!id) {
            throw new Error(
                'connect() requires a registrationId; call controlSub() first.');
        }

        this._autoReregister = (opts.autoReregister !== false);
        if (opts.autoRecover !== undefined) {
            this._autoRecover = (opts.autoRecover !== false);
        }
        this.registrationId = id;

        /* Shared transport: the registration lives on the owning publisher's
         * namespace, so its open socket already carries control frames. Bind the
         * command handler to it instead of opening our own socket. The server
         * only returns shared:true in response to an explicit attachTo, so a
         * shared registration without a bound publisher is an inconsistent state
         * (no socket to ride): fail loud rather than silently opening a socket to
         * the publisher namespace, which would never complete its handshake. */
        if (this.shared) {
            if (!this._publisher) {
                throw new Error(
                    'shared control transport requires an attached publisher; ' +
                    'call attachTo(publisher) before controlSub().');
            }
            this._wireSharedTransport();
            this._connected = true;
            this.emit('connect');
            return null;
        }

        const timeoutMs = (opts.timeoutMs !== undefined) ? opts.timeoutMs : 10000;

        /* CORE-9226 (review N1): getToken() may answer with a PROMISE (any
         * acquisition in flight); reading `.access_token` off it sent the
         * handshake out as `Authorization: undefined`, and the auth-shaped
         * denial parked the listener as a credential fault. Await the
         * credential before touching the existing socket; publisher.js
         * connect() carries the full reasoning -- the two socket entry
         * points share the defect and the fix. The shared-transport path
         * above deliberately stays token-free: it rides the owning
         * publisher's already-authenticated socket. */
        const token = await this._client.getToken();

        /* Detach any previous listener socket BEFORE opening a new one
         * (-lpa.2): a failed recovery attempt used to overwrite this.socket
         * while the old socket's reconnection loop kept running, leaking one
         * flapping socket per attempt. */
        this._detachSocket();

        const sock = this._openSocket(id, token.access_token);
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

            sock.once(CONNECTED_EVENT, () => {
                this._connected = true;
                finish(resolve, sock);
            });
            const rejectConnect = (reason) => {
                /* Auth denial is permanent until credentials / authz change:
                 * stop this socket's own reconnection ladder rather than let
                 * it flap behind the rejected promise (-lpa.2, hot-loop H2). */
                if (isAuthRejection(reason)) {
                    this.logger.warn(
                        'Control socket to %s denied (auth): %s; stopping '
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
     * Build (but do not open) a socket.io socket for the registration namespace,
     * mirroring WideSkyClient.getWatchSocket's URL/path/query derivation so the
     * listener handshake is byte-for-byte the consumer handshake.
     *
     * @param {string} registrationId The namespace.
     * @param {string} accessToken The bearer token for the handshake query,
     *        already RESOLVED by connect() (review N1; see publisher.js
     *        _openSocket for why this builder stays synchronous).
     * @returns {Object} An unopened socket.io socket.
     * @private
     */
    _openSocket(registrationId, accessToken) {
        const parsedUrl = new Url(this._client.baseUri);
        const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
        const url = `${baseUrl}/${registrationId}`;

        let subPath = '';
        if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
            subPath = parsedUrl.pathname;
        }

        this.logger.debug(
            `Control socket baseUrl: "${baseUrl}", subPath: "${subPath}", ` +
            `nsp: "${registrationId}"`
        );

        return socket.connect(url, {
            query: { Authorization: accessToken },
            'force new connection': true,
            autoConnect: false,
            reconnection: true,
            /* Reconnection pacing (-lpa.2, hot-loop audit H2): base 5 s,
             * ceiling 5 min, jittered, replacing socket.io's 1 s / 5 s
             * defaults that flap metered links. */
            reconnectionDelay: RECONNECTION_DELAY_MS,
            reconnectionDelayMax: RECONNECTION_DELAY_MAX_MS,
            randomizationFactor: RECONNECTION_JITTER,
            path: `${subPath}/socket.io`
        });
    }

    /**
     * Attach the command handler and lifecycle handlers to a standalone listener
     * socket. A pointWrite arrives inside the generic `message` envelope (the
     * command router emits socket.emit('message', control)).
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
        });

        sock.on(CONNECTED_EVENT, () => {
            this._connected = true;
            this._cancelPendingRecovery();
            this.emit('connect');
        });

        sock.on('disconnect', (reason) => {
            this.emit('disconnect', reason);
            this._scheduleRecovery(reason);
        });

        sock.on('connect_error', (reason) => {
            this.emit('connectionError', reason);
            this._recover(reason);
        });

        sock.on('connection_error', (reason) => {
            this.emit('connectionError', reason);
            this._recover(reason);
        });

        sock.on(MESSAGE_EVENT, (payload) => this._handleControlFrame(payload));
    }

    /**
     * Bind the command handler onto the owning publisher's socket for the shared
     * transport. The publisher forwards inbound control frames into the command
     * router server-side; on the client the SAME socket delivers them, so we
     * listen for control `message` frames on the publisher's socket and emit
     * 'command' for pointWrite.
     * @private
     */
    _wireSharedTransport() {
        const pubSocket = this._publisher.socket;
        if (!pubSocket) {
            throw new Error(
                'shared control transport requires a connected publisher socket; '
                + 'connect the publisher first.');
        }
        /* Dedupe (-lpa.2): each connect() used to ADD a handler without
         * removing the previous one, so a re-registration over the same
         * socket delivered every command twice. Unbind the previous handler
         * (from whichever socket OBJECT it was bound to) before binding. */
        this._unbindSharedHandler();
        this._sharedHandler = (payload) => this._handleControlFrame(payload);
        this._sharedSocket = pubSocket;
        pubSocket.on(MESSAGE_EVENT, this._sharedHandler);
    }

    /**
     * Remove the shared-transport command handler from the socket it was bound
     * to (which may be a dead socket the publisher has already swapped out).
     * @private
     */
    _unbindSharedHandler() {
        if (this._sharedHandler && this._sharedSocket
                && typeof this._sharedSocket.removeListener === 'function') {
            try {
                this._sharedSocket.removeListener(
                    MESSAGE_EVENT, this._sharedHandler);
            }
            catch (err) {
                /* best-effort */
            }
        }
        this._sharedHandler = null;
        this._sharedSocket = null;
    }

    /**
     * Re-register a SHARED registration after the owning publisher recovered
     * onto a fresh watch + socket (-lpa.2). The old registration died with the
     * superseded watch server-side and the old command handler is bound to a
     * dead socket object client-side, so both legs are rebuilt: a fresh
     * controlSub (attachTo re-derived from the publisher's CURRENT watchId,
     * never the retained stale one) and a rebind onto the publisher's current
     * socket. Retries with the same backoff policy as _recover.
     *
     * Overlapping swaps (-lpa.3): a publisher socket-loss storm can swap the
     * watch AGAIN while a resub is still in flight. The in-flight resub derived
     * its attachTo from the watchId that was live when it STARTED, so if it
     * completes against that now-superseded watch the registration is stranded
     * on a dead watch (the server routes pointWrites to a namespace nobody
     * holds) with no further event to shake it loose. This is the exact field
     * wedge widesky-edge-go's belt-and-braces service leg exists to refute; see
     * that repo's telemetry/lib/service.js _bindControlResub comment block.
     * Rather than coalesce-and-drop a swap that lands mid-resub, this method
     * records it (_resubPending) and, after each successful bind, re-checks
     * whether the publisher's watch moved (or another swap was requested)
     * during the recovery; if so it resubs again against the live watch, looping
     * until the bound watch matches the live watch (bounded by
     * RESUB_STABILISE_MAX so a non-stop swap cannot spin here forever).
     *
     * @param {*} cause The publisher's reregistered payload (for logging).
     * @private
     */
    async _resubShared(cause) {
        if (this._closed || !this.shared || !this._connected) {
            return;
        }
        if (!this._lastSubBody || !this._autoRecover) {
            return;
        }
        if (this._recovering) {
            /* A swap that arrives while a resub is already in flight is
             * RECORDED, not dropped: the re-check at the bottom of the loop
             * below sees this flag and resubs against the live watch so the
             * registration never strands on the superseded one (-lpa.3). */
            this._resubPending = true;
            return;
        }

        this._recovering = true;

        /* The handler is bound to the publisher's DEAD socket; drop it now so
         * a failed resub never leaves a stale binding behind. */
        this._unbindSharedHandler();

        let stabiliseGuard = 0;
        try {
            /* Emit INSIDE the guarded try/finally (kai-1, CORE-8790): see
             * publisher.js _recover for the full rationale. A throwing
             * 'recovering' listener must not leave this shared-resub guard
             * stuck true forever; catch it locally, log it loudly, and let
             * the stabilisation loop proceed regardless. */
            try {
                this.emit('recovering', cause || 'publisher reregistered');
            }
            catch (emitErr) {
                this.logger.error(emitErr, 'recovering listener threw');
            }

            /* Outer stabilisation loop: after each successful bind, re-check
             * whether the target watch moved during the recovery and, if so,
             * resub again against the live watch. */
            for (;;) {
                this._resubPending = false;
                /* The watch this pass targets: controlSub (below) derives its
                 * attachTo from this SAME publisher.watchId with no await in
                 * between, so this is exactly the watch this pass will bind. */
                const targetWatchId =
                    this._publisher ? this._publisher.watchId : null;

                let backoff = RECOVER_BACKOFF_MS;
                let bound = false;
                for (;;) {
                    if (this._closed) {
                        return;
                    }

                    try {
                        /* Drop the STALE attachTo (the superseded watchId):
                         * controlSub re-derives it from the attached publisher's
                         * current watch. */
                        const body = Object.assign({}, this._lastSubBody);
                        delete body.attachTo;

                        const res = await this.controlSub(
                            body, { timeout: RECOVERY_REQUEST_TIMEOUT_MS });
                        if (this._closed) {
                            return;
                        }

                        await this.connect(res.registrationId, {
                            autoReregister: this._autoReregister,
                            autoRecover: this._autoRecover
                        });

                        this.emit('reregister', res);
                        this.emit('reregistered', res);
                        bound = true;
                        break;
                    }
                    catch (err) {
                        if (this._closed) {
                            return;
                        }
                        let delay;
                        if (isAuthRejection(err)) {
                            delay = jitteredMs(AUTH_PARK_MS);
                            this.logger.error(err,
                                'Shared control re-registration DENIED (auth); '
                                + `parked, next attempt in ${delay} ms`);
                            this.emit('authParked',
                                { reason: err, retryInMs: delay });
                            backoff = AUTH_PARK_MS;
                        }
                        else {
                            delay = jitteredMs(backoff);
                            this.logger.warn(err,
                                'Shared control re-registration not yet '
                                + `accepted; retrying in ${delay} ms`);
                            backoff = Math.min(
                                backoff * 2, RECOVER_MAX_BACKOFF_MS);
                        }
                        this.emit('reregisterError', err);
                        await sleep(delay);
                    }
                }

                if (!bound) {
                    return;
                }

                /* Re-check against the LIVE watch. A swap that landed while the
                 * bind above was in flight either set _resubPending (its
                 * _resubShared call coalesced here) or moved publisher.watchId
                 * off targetWatchId; either way the bind we just made is on a
                 * now-dead watch, so go round again against the live one. */
                const liveWatchId =
                    this._publisher ? this._publisher.watchId : null;
                const swappedUnderneath =
                    this._resubPending || (liveWatchId !== targetWatchId);
                if (!swappedUnderneath) {
                    return;
                }
                if (++stabiliseGuard >= RESUB_STABILISE_MAX) {
                    this.logger.error(
                        { targetWatchId, liveWatchId },
                        'Shared control re-registration did not stabilise after '
                        + `${RESUB_STABILISE_MAX} passes; leaving it for the `
                        + 'next publisher reregistered event');
                    return;
                }
            }
        }
        finally {
            this._recovering = false;
            this._resubPending = false;
        }
    }

    /**
     * Dispatch an inbound `message` frame: a pointWrite request surfaces as a
     * 'command' event; anything else (e.g. a reportWrite echo) is ignored.
     *
     * @param {Object} payload The inbound frame.
     * @private
     */
    _handleControlFrame(payload) {
        if (!payload || typeof payload !== 'object') {
            return;
        }
        if (payload.command === CMD_POINT_WRITE) {
            this.emit('command', payload);
        }
    }

    /* ================================================================
     * Outbound reportWrite
     * ============================================================== */

    /**
     * Reply to a pointWrite command with a reportWrite frame settling the
     * request. Sent on whichever socket carries this registration: the owning
     * publisher's socket for the shared transport, else the standalone listener
     * socket.
     *
     * @param {string} requestId  The requestId of the pointWrite being settled.
     * @param {Array}  data       Per-point write results
     *                            [{ id, writeVal?, writeStatus, writeErr? }].
     * @param {Object} [opts]     { done=true } whether this fulfils the request.
     */
    reportWrite(requestId, data, opts = {}) {
        const sock = this._activeSocket();
        if (!sock) {
            throw new Error('reportWrite called before connect().');
        }

        const frame = {
            command: CMD_REPORT_WRITE,
            requestId,
            /* The command router requires a responseId distinct from the
             * requestId (a fresh uuid) on every reportWrite reply; without it the
             * server rejects the reply and the originating pointWrite never
             * settles, so it is re-emitted for the whole alive window. */
            responseId: uuidv4(),
            data: Array.isArray(data) ? data : [data],
            done: (opts.done !== false)
        };

        sock.emit(MESSAGE_EVENT, frame);
    }

    /**
     * The socket currently carrying this registration's control frames: the
     * owning publisher's socket for the shared transport, else our own.
     * @returns {Object|null}
     * @private
     */
    _activeSocket() {
        if (this.shared && this._publisher) {
            return this._publisher.socket;
        }
        return this.socket;
    }

    /* ================================================================
     * Socket-loss recovery (standalone transport only). A shared registration
     * follows the owning publisher's recovery; this session does not duplicate
     * it.
     * ============================================================== */

    /**
     * Schedule a socket-loss recovery after a plain `disconnect`, deferred so
     * socket.io's own reconnection can heal a transient drop first.
     * @param {*} reason The disconnect reason.
     * @private
     */
    _scheduleRecovery(reason) {
        if (this._closed || !this._autoRecover || !this._connected) {
            return;
        }
        if (this.shared) {
            return;
        }
        if (this._recovering || this._recoverTimer) {
            return;
        }
        this._recoverTimer = setTimeout(() => {
            this._recoverTimer = null;
            this._recover(reason);
        }, RECOVER_DISCONNECT_GRACE_MS);
        if (typeof this._recoverTimer.unref === 'function') {
            this._recoverTimer.unref();
        }
    }

    /**
     * Cancel a pending disconnect-grace recovery timer.
     * @private
     */
    _cancelPendingRecovery() {
        if (this._recoverTimer) {
            clearTimeout(this._recoverTimer);
            this._recoverTimer = null;
        }
    }

    /**
     * Force a fresh re-registration after a socket loss the dead-namespace path
     * will not catch (a clean restart presents as a plain disconnect /
     * connect_error). Tears the dead socket down, drops the stale registration
     * id, then re-runs registration (fresh controlSub + connect), retrying with
     * exponential backoff until accepted.
     *
     * @param {*} reason The triggering reason.
     * @private
     */
    async _recover(reason) {
        if (this._closed || !this._autoRecover || !this._connected) {
            return;
        }
        if (this.shared || this._recovering) {
            return;
        }
        if (!this._lastSubBody || !this._autoReregister) {
            return;
        }

        this._cancelPendingRecovery();
        this._recovering = true;

        this._detachSocket();

        let backoff = RECOVER_BACKOFF_MS;
        try {
            /* Emit INSIDE the guarded try/finally (kai-1, CORE-8790): see
             * publisher.js _recover for the full rationale. A throwing
             * 'recovering' listener must not leave _recovering stuck true
             * forever; catch it locally, log it loudly, and let the ladder
             * proceed regardless. */
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
                    const res = await this.controlSub(
                        Object.assign({}, this._lastSubBody),
                        { timeout: RECOVERY_REQUEST_TIMEOUT_MS }
                    );
                    if (this._closed) {
                        return;
                    }

                    await this.connect(res.registrationId, {
                        autoReregister: this._autoReregister,
                        autoRecover: this._autoRecover
                    });

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
                        /* Auth denial does not ride the transient ladder
                         * (-lpa.2): park at the capped cadence; each parked
                         * attempt re-reads the token. */
                        delay = jitteredMs(AUTH_PARK_MS);
                        this.logger.error(
                            err,
                            'Control listener recovery DENIED (auth); parked, '
                            + `next attempt in ${delay} ms`
                        );
                        this.emit('authParked', { reason: err, retryInMs: delay });
                        backoff = AUTH_PARK_MS;
                    }
                    else {
                        delay = jitteredMs(backoff);
                        this.logger.warn(
                            err,
                            'Control listener socket-loss recovery not yet '
                            + `accepted; retrying in ${delay} ms`
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
     * Detach and tear down the current listener socket without emitting a
     * user-facing disconnect (used internally before a re-register).
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
     * Cleanly close the session: stop the socket (no reconnect), drop the shared
     * handler off the owning publisher's socket, drop all listeners and clear
     * retained state. Optionally release the registration over REST first.
     *
     * @param {Object} [opts] { unsub=false } also issue controlUnsub.
     * @returns {Promise<void>}
     */
    async close(opts = {}) {
        this._closed = true;
        this._autoReregister = false;
        this._autoRecover = false;
        this._cancelPendingRecovery();

        /* Shared transport: detach our handler from the socket it was bound
         * to (which may be a socket the publisher has already swapped out)
         * but leave that socket alone (the publisher owns its lifecycle), and
         * drop the publisher 'reregistered' hook (-lpa.2). */
        this._unbindSharedHandler();
        this._detachPublisherHooks();

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

        if (opts.unsub && this.registrationId) {
            try {
                await this.controlUnsub(this.registrationId);
            }
            catch (err) {
                /* Registration may already be gone (publisher-watch release for a
                 * shared one). 404 is idempotent success for the owner. */
            }
        }

        this.removeAllListeners();
    }
}

module.exports = ControlSession;
// Reconnect / auth-park behaviour surface (-lpa.2), exported so consumers'
// vendor-contract tests can pin it against the installed tarball.
module.exports.isAuthRejection = isAuthRejection;
module.exports.AUTH_PARK_MS = AUTH_PARK_MS;
module.exports.RECONNECTION_DELAY_MS = RECONNECTION_DELAY_MS;
module.exports.RECONNECTION_DELAY_MAX_MS = RECONNECTION_DELAY_MAX_MS;
module.exports.RECOVER_MAX_BACKOFF_MS = RECOVER_MAX_BACKOFF_MS;
module.exports.RECOVERY_REQUEST_TIMEOUT_MS = RECOVERY_REQUEST_TIMEOUT_MS;
