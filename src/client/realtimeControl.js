/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

const EventEmitter = require('events');
const { v1: uuidv1 } = require('uuid');

/**
 * Realtime control command verbs, as understood by the WideSky API server's
 * realtime control router. Sent/received over the watch socket's `message`
 * event.
 */
const COMMAND = Object.freeze({
    POINT_WRITE: 'pointWrite',
    REPORT_WRITE: 'reportWrite',
});

/**
 * Valid `writeStatus` values for a point-write report. These mirror the API
 * server's accepted statuses; an edge responding to a write must use one of
 * these.
 */
const WRITE_STATUS = Object.freeze({
    OK: 'ok',
    DOWN: 'down',
    UNBOUND: 'unbound',
    FAULT: 'fault',
    DISABLED: 'disabled',
    UNKNOWN: 'unknown',
});

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * RealtimeControl wraps a watch socket (as returned by
 * `WideSkyClient.getWatchSocket()`) with the realtime point-write control
 * protocol. It serves both roles:
 *
 *  - **Responder** (an edge/gateway): register `onPointWrite(handler)`. When the
 *    server forwards a `pointWrite` request, the handler is invoked with the
 *    requested `[{id, value}]` rows; its result (`[{id, writeStatus, writeErr?}]`)
 *    is sent back as a `reportWrite` response with a fresh `responseId`.
 *
 *  - **Requestor** (e.g. a dashboard): call `pointWrite([{id, value}])` to issue
 *    a control request; the returned promise resolves with the correlated
 *    response message.
 *
 * Both directions travel over the socket's `message` event, matching the API
 * server's control router.
 */
class RealtimeControl extends EventEmitter {
    /**
     * @param {object} socket A connected (or connectable) socket.io-client Socket.
     * @param {object} [options]
     * @param {object} [options.logger] Optional bunyan-style logger.
     * @param {number} [options.requestTimeout] Default ms to wait for a response
     *        to a `pointWrite()` request before rejecting. Defaults to 30000.
     */
    constructor(socket, options = {}) {
        super();

        this._socket = socket;
        this._logger = options.logger || null;
        this._defaultTimeout = options.requestTimeout || DEFAULT_REQUEST_TIMEOUT_MS;

        /** Responder handler for inbound point-write requests. */
        this._writeHandler = null;

        /** requestId -> {resolve, reject, timer} for outbound requests. */
        this._pending = new Map();

        this._onMessage = this._onMessage.bind(this);
        this._socket.on('message', this._onMessage);
    }

    /**
     * Register the responder handler invoked for inbound point-write requests.
     *
     * @param {function(Array<{id:string,value:*}>, {requestId:string}): (Array<{id:string,writeStatus:string,writeErr?:string}>|Promise)} handler
     * @returns {RealtimeControl} this
     */
    onPointWrite(handler) {
        this._writeHandler = handler;
        return this;
    }

    /**
     * Issue a point-write control request (requestor role).
     *
     * @param {Array<{id:string,value:*}>} points Points and values to write.
     * @param {object} [options]
     * @param {string} [options.requestId] Override the generated request id.
     * @param {number} [options.timeout] Server-side control timeout (ms).
     * @param {number} [options.alive] Server-side control keep-alive (ms).
     * @param {boolean} [options.private] Server-side `private` flag.
     * @param {number} [options.waitTimeout] Client-side ms to await the response.
     * @returns {Promise<object>} Resolves with the correlated response message.
     */
    pointWrite(points, options = {}) {
        const requestId = options.requestId || uuidv1();
        const message = {
            command: COMMAND.POINT_WRITE,
            requestId: requestId,
            data: points,
        };
        if (options.timeout !== undefined) {
            message.timeout = options.timeout;
        }
        if (options.alive !== undefined) {
            message.alive = options.alive;
        }
        if (options.private !== undefined) {
            message.private = options.private;
        }

        const waitMs = options.waitTimeout || this._defaultTimeout;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(requestId);
                reject(new Error(
                    `pointWrite request ${requestId} timed out after ${waitMs} ms`
                ));
            }, waitMs);

            this._pending.set(requestId, { resolve, reject, timer });
            this._socket.emit('message', message);
        });
    }

    /**
     * Stop handling control messages and reject any pending requests.
     */
    close() {
        if (this._socket && typeof this._socket.removeListener === 'function') {
            this._socket.removeListener('message', this._onMessage);
        }
        for (const [requestId, pending] of this._pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(
                `pointWrite request ${requestId} cancelled: control closed`
            ));
        }
        this._pending.clear();
    }

    /**
     * Route an inbound control message to the responder or requestor path.
     * @private
     */
    _onMessage(message) {
        if (message == null || typeof message !== 'object') {
            return;
        }

        // Inbound request for an edge to action (responder role).
        if (message.command === COMMAND.POINT_WRITE && this._writeHandler) {
            return this._handlePointWriteRequest(message);
        }

        // Correlated response to one of our outbound requests (requestor role).
        if (message.requestId != null && this._pending.has(message.requestId)) {
            return this._handleResponse(message);
        }

        // Anything else is surfaced for callers that want the raw stream.
        this.emit('message', message);
    }

    /**
     * Responder path: invoke the registered handler and reply with reportWrite.
     * @private
     */
    async _handlePointWriteRequest(message) {
        const rows = Array.isArray(message.data) ? message.data : [];
        let results;

        try {
            results = await this._writeHandler(rows, { requestId: message.requestId });
        } catch (err) {
            /* istanbul ignore next */
            if (this._logger) {
                this._logger.warn(err, 'point-write handler threw; reporting fault');
            }
            results = rows.map((row) => ({
                id: row.id,
                writeStatus: WRITE_STATUS.FAULT,
                writeErr: err && err.message ? err.message : 'point-write handler error',
            }));
        }

        this._socket.emit('message', {
            command: COMMAND.REPORT_WRITE,
            requestId: message.requestId,
            responseId: uuidv1(),
            data: results,
        });
    }

    /**
     * Requestor path: resolve the pending promise for a correlated response.
     * @private
     */
    _handleResponse(message) {
        const pending = this._pending.get(message.requestId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timer);
        this._pending.delete(message.requestId);
        pending.resolve(message);
    }
}

module.exports = { RealtimeControl, COMMAND, WRITE_STATUS };
