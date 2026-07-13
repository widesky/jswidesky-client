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
 *     to enable it. The shared session tracks the publisher's socket swaps
 *     (socketSwap event) so it rebinds its command handler whenever the
 *     publisher recovers and replaces its socket.
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

/** Initial / ceiling backoff (ms) for socket-loss re-registration retries. */
const RECOVER_BACKOFF_MS = 1000;
const RECOVER_MAX_BACKOFF_MS = 30000;

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

        /* In-flight one-shot re-register guard (dead-namespace path), so a burst
         * of connection_error / 404 signals coalesces into one attempt. */
        this._reregistering = false;

        /* Pending grace timer for a plain disconnect; a within-grace rejoin
         * cancels it. */
        this._recoverTimer = null;

        /* The shared-transport command handler bound to the owning publisher's
         * socket, retained so it can be detached on a socket swap and on close. */
        this._sharedHandler = null;

        /* The publisher socketSwap listener (shared transport) so the command
         * handler rebinds to the publisher's new socket after a recovery, and so
         * it can be removed on close. */
        this._sharedSwapHandler = null;
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
        this._publisher = publisher;
        return this;
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
    connect(registrationId, opts = {}) {
        const id = registrationId || this.registrationId;
        if (!id) {
            return Promise.reject(new Error(
                'connect() requires a registrationId; call controlSub() first.'));
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
                return Promise.reject(new Error(
                    'shared control transport requires an attached publisher; ' +
                    'call attachTo(publisher) before controlSub().'));
            }
            this._wireSharedTransport();
            this._connected = true;
            this.emit('connect');
            return Promise.resolve(null);
        }

        const timeoutMs = (opts.timeoutMs !== undefined) ? opts.timeoutMs : 10000;
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
             * its persistent connect_error handler) hammering the server. */
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

            sock.once(CONNECTED_EVENT, () => {
                this._connected = true;
                settle(resolve, sock);
            });
            sock.once('connect_error', (reason) => rejectWith(reason));
            sock.once('connection_error', (reason) => rejectWith(reason));

            sock.open();
        });
    }

    /**
     * Build (but do not open) a socket.io socket for the registration namespace,
     * mirroring WideSkyClient.getWatchSocket's URL/path/query derivation so the
     * listener handshake is byte-for-byte the consumer handshake.
     *
     * @param {string} registrationId The namespace.
     * @returns {Object} An unopened socket.io socket.
     * @private
     */
    _openSocket(registrationId) {
        const token = this._client.getToken();
        const accessToken = token.access_token;

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
            /* A failed reconnection attempt against a namespace that no longer
             * exists (post-restart) is a dead-socket signal. Recover now (the
             * backoff retry loop) rather than wait out the disconnect grace. */
            this._recover(reason);
        });

        sock.on('connection_error', (reason) => {
            this.emit('connectionError', reason);
            /* A connection_error is a transport/handshake reject distinct from a
             * dead-namespace reconnection failure (a non-owner / authz reject
             * surfaces here). Mirror PublisherSession: route it to the one-shot
             * dead-namespace re-register, NOT the connect_error retry loop, so a
             * reject that will never clear does not storm a fresh controlSub on
             * an endless backoff. */
            this._maybeReregister(reason);
        });

        sock.on(MESSAGE_EVENT, (payload) => this._handleControlFrame(payload));
    }

    /**
     * Bind the command handler onto the owning publisher's socket for the shared
     * transport. The publisher forwards inbound control frames into the command
     * router server-side; on the client the SAME socket delivers them, so we
     * listen for control `message` frames on the publisher's socket and emit
     * 'command' for pointWrite.
     *
     * The publisher owns its socket lifecycle and replaces the socket on a
     * recovery / dead-namespace re-register (emitting socketSwap). We subscribe
     * to that event and rebind the command handler to the publisher's NEW socket
     * so a shared listener does not go deaf after the publisher recovers.
     * @private
     */
    _wireSharedTransport() {
        const pubSocket = this._publisher.socket;
        if (!pubSocket) {
            throw new Error(
                'shared control transport requires a connected publisher socket; '
                + 'connect the publisher first.');
        }
        this._sharedHandler = (payload) => this._handleControlFrame(payload);
        pubSocket.on(MESSAGE_EVENT, this._sharedHandler);

        /* Rebind onto the publisher's new socket whenever it swaps (recovery /
         * re-register). The old socket was torn down by the publisher
         * (removeAllListeners), so we only need to (re)attach to the new one.
         * The publisher is an EventEmitter in normal use; guard the subscription
         * so a publisher-like object without an event surface still delivers
         * commands (it simply will not auto-rebind across a swap). */
        if (!this._sharedSwapHandler
                && typeof this._publisher.on === 'function') {
            this._sharedSwapHandler = (newSocket) =>
                this._rebindSharedTransport(newSocket);
            this._publisher.on('socketSwap', this._sharedSwapHandler);
        }
    }

    /**
     * Rebind the shared command handler from a torn-down publisher socket onto
     * the publisher's new socket after a socketSwap. Idempotent and tolerant of
     * a missing new socket.
     *
     * @param {Object} newSocket The publisher's replacement socket.
     * @private
     */
    _rebindSharedTransport(newSocket) {
        if (this._closed) {
            return;
        }
        const target = newSocket || (this._publisher && this._publisher.socket);
        if (!target || !this._sharedHandler) {
            return;
        }
        /* The previous socket was removeAllListeners()'d by the publisher's
         * teardown, so there is nothing to detach there; just (re)bind on the
         * new socket, guarding against a duplicate if this fires twice. */
        target.removeListener(MESSAGE_EVENT, this._sharedHandler);
        target.on(MESSAGE_EVENT, this._sharedHandler);
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
     * follows the owning publisher's recovery (it rebinds on the publisher's
     * socketSwap event); this session does not run its own recovery for the
     * shared transport.
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
     * One-shot fresh re-registration for the dead-namespace signal (a
     * connection_error: a non-owner / authz reject, or a namespace that went
     * away). Mirrors PublisherSession._maybeReregister: tears the dead socket
     * down, re-registers ONCE with a fresh controlSub + connect, and on failure
     * emits reregisterError and STOPS (no retry loop). This is the deliberate
     * counterpart to _recover's backoff loop: a connection_error that will never
     * clear must not storm a fresh controlSub forever.
     *
     * @param {*} reason The triggering reason.
     * @private
     */
    async _maybeReregister(reason) {
        if (this._closed || !this._autoRecover || !this._connected) {
            return;
        }
        if (this.shared || this._recovering || this._reregistering) {
            return;
        }
        if (!this._lastSubBody || !this._autoReregister) {
            return;
        }

        this._cancelPendingRecovery();
        this._reregistering = true;
        this.emit('recovering', reason);

        /* Tear the dead socket down before re-registering so its automatic
         * reconnection loop does not keep hammering the gone namespace. */
        this._detachSocket();

        try {
            const res = await this.controlSub(
                Object.assign({}, this._lastSubBody));
            if (this._closed) {
                return;
            }

            await this.connect(res.registrationId, {
                autoReregister: this._autoReregister,
                autoRecover: this._autoRecover
            });

            this.emit('reregister', res);
            this.emit('reregistered', res);
        }
        catch (err) {
            this.logger.warn(
                err,
                'Control listener re-register after dead namespace failed');
            this.emit('reregisterError', err);
        }
        finally {
            this._reregistering = false;
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
        if (this.shared || this._recovering || this._reregistering) {
            return;
        }
        if (!this._lastSubBody || !this._autoReregister) {
            return;
        }

        this._cancelPendingRecovery();
        this._recovering = true;
        this.emit('recovering', reason);

        this._detachSocket();

        let backoff = RECOVER_BACKOFF_MS;
        try {
            for (;;) {
                if (this._closed) {
                    return;
                }

                try {
                    const res = await this.controlSub(
                        Object.assign({}, this._lastSubBody));
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
                    this.logger.warn(
                        err,
                        'Control listener socket-loss recovery not yet accepted; '
                        + `retrying in ${backoff} ms`
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
     * Tear down a specific socket: remove its listeners, stop its reconnection
     * loop, and close the transport. Safe on an already-closed socket.
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
        this._teardownSocket(sock);
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

        /* Shared transport: detach our handler from the publisher's socket and
         * stop tracking its socket swaps, but leave that socket alone (the
         * publisher owns its lifecycle). */
        if (this._sharedSwapHandler && this._publisher
                && typeof this._publisher.removeListener === 'function') {
            try {
                this._publisher.removeListener(
                    'socketSwap', this._sharedSwapHandler);
            }
            catch (err) {
                /* best-effort */
            }
        }
        this._sharedSwapHandler = null;

        if (this._sharedHandler && this._publisher && this._publisher.socket) {
            try {
                this._publisher.socket.removeListener(
                    MESSAGE_EVENT, this._sharedHandler);
            }
            catch (err) {
                /* best-effort */
            }
        }
        this._sharedHandler = null;

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
