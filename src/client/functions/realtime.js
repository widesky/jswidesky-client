/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

/*
 * Realtime client operations for WideSkyClient: watch lifecycle (watchSub /
 * watchExtend / watchUnsub), the watch socket (getWatchSocket) and its control
 * wrapper (watchControl), and the point-write control op (pointWrite).
 *
 * These are attached as direct methods on the client instance (see
 * `assignSubFunctions` in client.js) so call sites remain `client.watchSub(...)`,
 * `client.pointWrite(...)`, etc. Each function runs with `this` bound to the
 * WideSkyClient instance and uses its `submitRequest`, `getToken`, `baseUri`
 * and `logger`.
 */

const socket = require('socket.io-client');
const Url = require('url-parse');
const { RealtimeControl } = require('../realtimeControl');

/**
 * Initiate a haystack watchSub op based on the given list of point ids
 * @param {*} pointIds String or Array. The point Ids to perform watchSub on.
 * @param {string} lease Duration (ms) the watch will exist
 * @param {string} description A short description for the watch session
 * @param {Object} config Configuration options used in `submitRequest()`
 * @returns Promise that resolves to a watch object.
 */
function watchSub(pointIds, lease, description, config = {}) {
    if (!(Array.isArray(pointIds))) {
        pointIds = [pointIds];
    }

    const rows = pointIds.map((id) => {
        return {id: `r:${id}`};
    });

    return this.submitRequest(
        'POST',
        '/api/watchSub',
        {
            meta: {
                ver: '2.0',
                watchDis: `s:${description}`,
                lease: lease
            },
            cols: [
                {name: 'id'}
            ],
            rows: rows
        },
        config
    );
}

/**
 * Initiate a haystack watchSub op to extend a watch given the watchId
 * and lease.
 * @param {string} watchId ID of the opened watch.
 * @param {*} pointIds String or Array. The points.
 * @param {string} lease Duration (ms) the watch was created with.
 * @param {Object} config Configuration options used in `submitRequest()`
 * @returns Promise
 */
function watchExtend(watchId, pointIds, lease, config = {}) {
    if (!(Array.isArray(pointIds))) {
        pointIds = [pointIds];
    }

    const rows = pointIds.map((id) => {
        return {id: `r:${id}`};
    });

    return this.submitRequest(
        'POST',
        '/api/watchSub',
        {
            meta: {
                ver: '2.0',
                watchId: `s:${watchId}`,
                lease: lease
            },
            cols: [{name: 'id'}],
            rows: rows
        },
        config
    );
}

/**
 * Initiate a watchUnsub op using the given watchId.
 * If deletePointIds is set, then the listed points will be removed
 * from the watch.
 * @param {string} watchId ID of the opened watch.
 * @param {*} deletePointIds String or Array. The points to be deleted.
 * @param {boolean} close If true, the watch session will be closed.
 * @param {Object} config Configuration options used in `submitRequest()`
 * @returns Promise
 */
function watchUnsub(watchId, deletePointIds, close = true, config = {}) {
    if (!(Array.isArray(deletePointIds))) {
        deletePointIds = [deletePointIds];
    }

    const payload = {
        meta: {
            ver: '2.0',
            watchId: `s:` + watchId,
        },
        cols: [],
        rows: []
    };

    if (deletePointIds.length > 0) {
        payload.cols.push({name: 'id'});

        for (let index = 0; index < deletePointIds.length; index++) {
            payload.rows.push({id: 'r:' + deletePointIds[index]});
        }
    }
    else {
        payload.cols.push({name: 'empty'});
    }

    if (close) {
        payload.meta['close'] = 'm:';
    }

    return this.submitRequest(
        'POST',
        '/api/watchUnsub',
        payload,
        config
    );
}

/**
 * Initiate a watch socket object given a valid watch ID string.
 *
 * The access token is resolved via `getToken()`, which may need to perform
 * a login or refresh and therefore returns a promise; this method awaits it
 * so the socket is always created with a valid token rather than an
 * `undefined` Authorization (which would happen if the token had to be
 * acquired or refreshed at call time).
 *
 * @param {string} watchId the watch ID string.
 * @returns {Promise<object>} Resolves to a socket.io Socket object.
 */
async function getWatchSocket(watchId) {
    const tokens = await this.getToken();
    const accessToken = tokens.access_token;

    const parsedUrl = new Url(this.baseUri);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const url = `${baseUrl}/${watchId}`;

    let subPath = '';
    if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
        subPath = parsedUrl.pathname;
    }

    this.logger.debug(
        `baseUrl: "${baseUrl}", subPath: "${subPath}", nsp: "${watchId}"`
    );

    const watchSocket = socket.connect(url, {
        query: { Authorization: accessToken },
        'force new connection': true,
        autoConnect: false,
        path: `${subPath}/socket.io`
    });

    // The access token captured above is short-lived, but a watch socket
    // (e.g. a gateway's) can live far longer. socket.io re-presents the
    // `query.Authorization` captured at connect time on every reconnect,
    // so once the token rotates the reconnect handshakes would fail auth.
    // Refresh the token onto the connection options on reconnect so the next
    // handshake carries a valid token.
    //
    // Known limitation: socket.io-client v2 emits `reconnect_attempt`
    // synchronously and calls `open()` immediately, before this async refresh
    // resolves — so the *first* attempt after a token rotation can still use
    // the stale token. socket.io's backoff retries then carry the refreshed
    // token (recovery within a few seconds). Fully closing the gap would need a
    // synchronously-available token (e.g. a pre-fetched/cached one).
    if (watchSocket && typeof watchSocket.on === 'function') {
        watchSocket.on('reconnect_attempt', async () => {
            try {
                const refreshed = await this.getToken();
                if (watchSocket.io && watchSocket.io.opts) {
                    watchSocket.io.opts.query = Object.assign(
                        {},
                        watchSocket.io.opts.query,
                        { Authorization: refreshed.access_token }
                    );
                }
            } catch (err) {
                /* istanbul ignore next */
                if (this.logger) {
                    this.logger.warn(
                        err,
                        'Failed to refresh watch socket token on reconnect'
                    );
                }
            }
        });
    }

    return watchSocket;
}

/**
 * Wrap a watch socket with the realtime point-write control protocol
 * (`pointWrite`/`reportWrite`). Use the returned {@link RealtimeControl} to
 * either respond to inbound point-write requests (edge/gateway role, via
 * `onPointWrite`) or issue them (dashboard role, via `pointWrite`).
 *
 * @param {object} watchSocket A socket from {@link WideSkyClient#getWatchSocket}.
 * @param {object} [options] Options forwarded to the RealtimeControl.
 * @returns {RealtimeControl}
 */
function watchControl(watchSocket, options = {}) {
    return new RealtimeControl(watchSocket, Object.assign(
        { logger: this.logger },
        options
    ));
}

/**
 * Write a value to a level of a writable point's priority array via the
 * Haystack `pointWrite` op, and return the current state of the priority array.
 *
 * `val` and `duration` follow the same convention as `hisWrite`: pass the
 * Haystack-JSON-encoded value (e.g. `'n:5'`, `true`, `'s:on'`), or `null` to
 * auto/release the level. `level`, `who` and the point id are encoded here.
 *
 * @param {string} pointId Identifier of a writable point.
 * @param {number} level Priority array level, 1-17.
 * @param {*} val Value to write (Haystack-JSON encoded), or null to auto the level.
 * @param {string} [who] Username performing the write; the user dis is used if omitted.
 * @param {*} [duration] Duration value (Haystack-JSON encoded) when writing level 8.
 * @param {Object} [config] Configuration options used in `submitRequest()`.
 * @returns Promise that resolves into a haystack response grid.
 */
function pointWrite(pointId, level, val, who = null, duration = null, config = {}) {
    const row = {
        id: `r:${pointId}`,
        level: `n:${level}`,
        who: (who === null || who === undefined) ? null : `s:${who}`,
        val: (val === undefined) ? null : val,
        duration: (duration === undefined) ? null : duration
    };

    return this.submitRequest(
        'POST',
        '/api/pointWrite',
        {
            meta: {ver: '2.0'},
            cols: [
                {name: 'id'},
                {name: 'level'},
                {name: 'who'},
                {name: 'val'},
                {name: 'duration'}
            ],
            rows: [row]
        },
        config
    );
}

module.exports = {
    watchSub,
    watchExtend,
    watchUnsub,
    getWatchSocket,
    watchControl,
    pointWrite
};
