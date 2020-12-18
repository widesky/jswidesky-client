/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 */
"use strict";

var Promise = require('bluebird'),
    request = require('request-promise'),
    rqerr = require('request-promise/errors'),
    data = require('./data'),
    replace = require('./graphql/replace'),
    _ = require('lodash');

/**
 * WideSky Client: This is a simplified HTTP-based client for communicating
 * with the WideSky API server.  It supports CRUD ops and hisWrite.
 *
 * @param   base_uri    URI to the WideSky API server (string),
 *                      e.g. 'https://widesky.example.com/widesky/'
 *
 * @param   username    Username to use when logging into WideSky (string)
 * @param   password    Password corresponding to the given username (string)
 * @param   client_id   Client ID to use when authenticating to WideSky
 *                      (string)
 * @param   client_secret
 *                      Authentication secret to use that corresponds to the
 *                      given client ID (string)
 *
 * @param   log         Optional bunyan instance for logging
 * @param   access_token
 *                      Optional widesky access token.
 *                      For application whom would like to seed the client
 *                      with a known access token to avoid having to perform
 *                      the login operation again.
 */
var WideSkyClient = function(base_uri,
                             username,
                             password,
                             client_id,
                             client_secret,
                             log,
                             access_token) {
    /* Self reference */
    var self = this;

    /*
     * HTTP library references, these may be replaced with stubs for testing.
     */
    self._request = request;
    self._rqerr = rqerr;

    /* Logger instance */
    self._log = log;

    if (access_token) {
        if (!_.has(access_token, "refresh_token") ||
            !_.has(access_token, "expires_in") ||
            !_.has(access_token, "token_type") ||
            !_.has(access_token, "access_token")) {
            throw new Error("Parameter 'access_token' is not a valid Widesky token.");
        }
    }

    /*
     * The authentication response, used for storing the access token and
     * refresh token.
     */
    var _ws_token = access_token || null;
    /*
     * Refresh token retrieval.  The list of waiters for a refresh token
     * add themselves here.  If `null`, then no refresh is in progress.
     */
    var _ws_token_wait = null;

    /**
     * The user id which the original user is impersonating as.
     */
    var _impersonate = null;

    /**
     * If this is true (default) then all http requests made by the client
     * will have the 'Accept-Encoding' header with value of 'gzip, compress, br'
     * append to it.
     *
     * @type {boolean}
     * @private
     */
    var _acceptGzipEncoding = true;

    /**
     * Private method: perform a new log-in.  Returns JSON response from
     * server or raises an error.
     */
    var doLogin = function() {
        /* istanbul ignore next */
        if (self._log) self._log.trace('Performing login attempt');
        return self._ws_raw_submit({
            method: 'POST',
            uri: '/oauth2/token',
            auth: {
                username: client_id,
                password: client_secret,
                sendImmediately: true
            },
            json: true,
            body: {
                username: username,
                password: password,
                grant_type: 'password'
            }
        });
    };

    /**
     * Private method: refresh a token.  Returns JSON response from server or
     * raises an error.  Requires that _ws_token is not null.
     */
    var doRefresh = function() {
        /* istanbul ignore next */
        if (self._log) self._log.trace('Performing token refresh attempt');
        return self._ws_raw_submit({
            method: 'POST',
            uri: '/oauth2/token',
            auth: {
                username: client_id,
                password: client_secret,
                sendImmediately: true
            },
            json: true,
            body: {
                refresh_token: _ws_token.refresh_token,
                grant_type: 'refresh_token'
            }
        });
    };

    /**
     * Private method: retrieve the access token.  This performs a login if
     * the current token is absent or attempts a refresh if expired.
     */
    var getToken = function() {
        var firstStep;
        var refresh = false;

        /* Is a request in progress? */
        if (_ws_token_wait !== null) {
            /* Join the queue */
            /* istanbul ignore next */
            if (self._log) self._log.trace('Waiting for token acquisition');
            return new Promise(function (resolve, reject) {
                _ws_token_wait.push({
                    resolve: resolve,
                    reject: reject
                });
            });
        }

        if (_ws_token === null) {
            /* No token, so acquire one */
            _ws_token_wait = [];
            /* istanbul ignore next */
            if (self._log) self._log.trace('Begin token acquisition');
            firstStep = doLogin();
        } else if (_ws_token.expires_in < Date.now()) {
            /* Token is expired, so do a refresh */
            /* istanbul ignore next */
            if (self._log) self._log.trace('Begin token refresh');
            _ws_token_wait = [];
            firstStep = doRefresh();
            refresh = true;
        } else {
            /* We have a token, dummy promise */
            return new Promise(function (resolve, reject) {
                resolve(_ws_token.access_token);
            });
        }

        return new Promise(function (resolve, reject) {
            var success = function (token) {
                /* istanbul ignore next */
                if (self._log) self._log.info('Logged in to API server');
                _ws_token = token;

                var waiters = _ws_token_wait;
                _ws_token_wait = null;

                resolve(token.access_token);
                waiters.forEach(function (waiter) {
                    waiter.resolve(token.access_token);
                });
            };

            var fail = function (err) {
                /* istanbul ignore next */
                if (self._log) self._log.warn(err, 'Failed to log into API server');
                _ws_token = null;

                var waiters = _ws_token_wait;
                _ws_token_wait = null;

                reject(err);
                waiters.forEach(function (waiter) {
                    waiter.reject(err);
                });
            }

            return firstStep.then(success).catch(function (err) {
                /* If we're refreshing, try a full log-in */
                if (refresh) {
                    /* istanbul ignore next */
                    if (self._log) self._log.info(err,
                        'Refresh fails, trying log-in instead');
                    doLogin().then(success).catch(fail);
                } else {
                    fail(err);
                }
            });
        });
    };

    /**
     * Protected method for submitting requests against the API server.
     * This takes an options object for `request-bluebird` and injects
     * the base URI for submitting requests.
     */
    self._ws_raw_submit = function(options) {
        options = Object.assign({}, options);
        options.baseUrl = base_uri;
        /* istanbul ignore next */
        if (self._log) self._log.trace(options, 'Raw request');
        return self._request(options);
    };

    /**
     * Protected method for submitting a Project Haystack request.  This
     * retrieves the access token then injects it into the request and submits
     * it.  It also handles the case where a request fails due to an invalid
     * token.
     */
    self._ws_hs_submit = function(options) {
        var submit = (token) => {
            /* Prepare request */
            options = Object.assign({}, options);
            if (options.headers === undefined) {
                /* Initialise new headers */
                options.headers = {};
            } else {
                /* Copy existing settings */
                options.headers = Object.assign({}, options.headers);
            }

            /* Set headers */
            options.headers['Authorization'] = 'Bearer ' + token;
            options.headers['Accept'] = 'application/json';

            if (this.isAcceptingGzip() &&
                !options.headers.hasOwnProperty("Accept-Encoding")) {
                options.headers["Accept-Encoding"] = "gzip, compress, br";
            }

            if (this.isImpersonating()) {
                options.headers['X-IMPERSONATE'] = this._impersonate;
            }

            /* Expect JSON reply */
            options.json = true;

            /* istanbul ignore next */
            if (self._log) self._log.trace('Sending request');
            return self._ws_raw_submit(options);
        };

        /* istanbul ignore next */
        if (self._log) self._log.trace(options, 'Haystack request');

        return new Promise(function (resolve, reject) {
            /* istanbul ignore next */
            if (self._log) self._log.trace('Need token');
            getToken().then(function (token) {
                /* istanbul ignore next */
                if (self._log) self._log.trace('Got token');
                submit(token).then(resolve).catch(function (err) {
                    /* Did we get a 401? */
                    if ((err instanceof self._rqerr.StatusCodeError)
                            && (err.statusCode === 401))
                    {
                        /* Invalidate our token then try again, *once* */

                        /*
                         * Ignore the else branch in code coverage, as
                         * we should not ordinarily wind up here if the token
                         * is invalid.  To test, we've got to trigger a tricky
                         * race condition between `getToken` and `submit`.
                         */

                        /* istanbul ignore else */
                        if (_ws_token_wait === null) {
                            /* istanbul ignore next */
                            if (self._log) self._log.trace('Invalidated token');
                            _ws_token = null;
                        }

                        getToken().then(function (token) {
                            submit(token).then(resolve).catch(reject);
                        }).catch(reject);
                    } else {
                        reject(err);
                    }
                });
            }).catch(function (err) {
                reject(err);
            });
        });
    };

    /**
     * Perform a log-in, if not already done.  This does a `getToken` whilst
     * performing no further operations.
     */
    self.login = () => {
        return getToken().then(() => {
            return undefined;
        });
    };

    self.impersonateAs = function(userId) {
        this._impersonate = userId;
    };

    self.isImpersonating = function() {
        return !!this._impersonate;
    };

    self.unsetImpersonate = function() {
        this._impersonate = null;
    };

    self.setAcceptGzip = function(acceptGzip) {
        _acceptGzipEncoding = Boolean(acceptGzip);
    }

    self.isAcceptingGzip = function() {
        return _acceptGzipEncoding;
    }
};


/**
 * Perform a `read` request of the WideSky API server.  This function takes
 * one or more IDs expressed as a list.
 *
 * @param   ids     Entity IDs, either a single ID or an array.  (string or
 *                  array of strings)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.read = function(ids) {
    if (((typeof ids) === 'string') || (ids.length === 1)) {
        if (!((typeof ids) === 'string')) {
            ids = ids[0];
        }

        return this._ws_hs_submit({
            method: 'GET',
            uri: '/api/read',
            qs: {
                id: (new data.Ref(ids)).toHSZINC()
            }
        });
    } else {
        return this._ws_hs_submit({
            method: 'POST',
            uri: '/api/read',
            body: {
                meta: {
                    ver: '2.0',
                },
                cols: [
                    {name: 'id'}
                ],
                rows: ids.map(function (id) {
                    return {id: (new data.Ref(id)).toHSJSON()};
                })
            }
        });
    }
};

/**
 * Perform a graphql request to the WideSky API server.
 * This function takes in a string which contains the
 * graph query.
 *
 * @param   graphql The graph query
 * @returns Promise that resolves to the graphql response.
 */
WideSkyClient.prototype.query = function(graphql) {
    graphql = replace.outerBraces(graphql);
    let body = { "query": graphql }

    return this._ws_hs_submit({
        method: 'POST',
        uri: '/graphql',
        body: body
    });
}

/**
 * Process a `filter` and `limit`; and use these to generate the query
 * arguments.  Used by `find` and `deleteByFilter`.
 */
const _get_filter_limit_args = function (filter, limit) {
    var args = {
        filter: filter.toHSZINC()
    };

    if ((typeof limit) === 'number') {
        args.limit = limit.toHSZINC();
    }

    return args;
};


/**
 * Perform a `read` request of the WideSky API server.  This function takes
 * a filter string which is used by the server to scan matching entities.
 *
 * @param   filter      Filter expression (string)
 * @param   limit       Optional limit on the number of entities (integer)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.find = function (filter, limit) {
    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/read',
        qs: _get_filter_limit_args(filter, limit)
    });
};


/**
 * Perform a cache reload request of the WideSky API server.
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.reloadCache = function () {
    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/reloadAuthCache'
    });
};

/** Special columns, these will be placed in the given order */
const SPECIAL_COLS = ['id', 'name', 'dis'];

/**
 * Create or Update one or more entities.
 *
 * @param   op          Operation to perform
 * @param   entities    Array of entity objects
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype._create_or_update = function (op, entities) {
    if (!(entities instanceof Array)) {
        entities = [entities];
    }

    /* Generate the columns, make a note of the haystack version needed */
    var cols = [], present = {}, ver = '2.0';
    entities.forEach(function (entity) {
        Object.keys(entity).forEach(function (col) {
            present[col] = true;

            /* Upgrade to Haystack 3.0 */
            if (entity[col] instanceof Array)
                ver = '3.0';
        });
    });

    /* Ensure updateRec lists `id` */
    if ((!present.id) && (op === 'updateRec')) {
        /* istanbul ignore next */
        if (this._log) this._log.trace(entities, 'Entities lacks id column');
        throw new Error('id is missing');
    }

    /* Generate the columns to be emitted, starting with the special ones */
    SPECIAL_COLS.forEach((c) => {
        if (present[c]) {
            cols.push(c);
            delete present[c];
        }
    });

    /* Add the others in, in alphabetical order */
    Object.keys(present).sort().forEach((c) => {
        cols.push(c);
    });

    return this._ws_hs_submit({
        method: 'POST',
        uri: '/api/' + op,
        body: {
            meta: {ver: ver},
            cols: cols.map(function (c) {
                return {name: c};
            }),
            rows: entities
        }
    });
};


/**
 * Create one or more entities.  This takes an array of objects and attempts
 * to create those entities in WideSky.
 *
 * @param   entities    Array of entity objects
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.create = function (entities) {
    return this._create_or_update('createRec', entities);
};


/**
 * Update one or more entities.  This takes an array of objects and attempts
 * to update those entities in WideSky.
 *
 * @param   entities    Array of entity objects
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.update = function (entities) {
    return this._create_or_update('updateRec', entities);
};

/**
 * Change the current session user's password.
 *
 * @param   newPassword - A string
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.updatePassword = function (newPassword) {
    /* istanbul ignore next */
    if (this._log) {
        this._log.trace('Updating password');
    }

    if (!newPassword) {
        throw new Error('New password cannot be empty.');
    }

    return this._ws_hs_submit({
        method: 'POST',
        uri: '/user/updatePassword',
        body: {
            "newPassword": newPassword
        }
    });
};

/**
 * Delete one or more entities given as IDs.
 *
 * @param   ids     Entity IDs, either a single ID or an array.  (string or
 *                  array of strings)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.deleteById = function(ids) {
    if (((typeof ids) === 'string') || (ids.length === 1)) {
        if (!((typeof ids) === 'string')) {
            ids = ids[0];
        }

        return this._ws_hs_submit({
            method: 'GET',
            uri: '/api/deleteRec',
            qs: {
                id: (new data.Ref(ids)).toHSZINC()
            }
        });
    } else {
        return this._ws_hs_submit({
            method: 'POST',
            uri: '/api/deleteRec',
            body: {
                meta: {
                    ver: '2.0',
                },
                cols: [
                    {name: 'id'}
                ],
                rows: ids.map(function (id) {
                    return {id: (new data.Ref(id)).toHSJSON()}
                })
            }
        });
    }
};


/**
 * Delete entities that match a given filter string.
 *
 * @param   filter      Filter expression (string)
 * @param   limit       Optional limit on the number of entities to delete
 *                      (integer)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.deleteByFilter = function (filter, limit) {
    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/deleteRec',
        qs: _get_filter_limit_args(filter, limit)
    });
};


/**
 * Perform a history read request.
 *
 * @param   ids         (string)    Entity to read
 *                      (array)     Entities to read (multi-point)
 * @param   from        (string)    Textual read range (e.g. "today")
 *                      (Date)      Starting timestamp of read
 * @param   to          (Date)      Ending timestamp of read
 *
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.hisRead = function (ids, from, to) {
    var range;
    if (to !== undefined) {
        /* Full range given, both from and to *must* be Dates */
        if (!(from instanceof Date))
            throw new Error('`from` is not a Date');
        if (!(to instanceof Date))
            throw new Error('`to` is not a Date');

        range = from.toHSZINC() + ',' + to.toHSZINC();
    } else {
        range = from;
    }

    if (!(ids instanceof Array))
        ids = [ids];

    var args = {
        range: range.toHSZINC()
    };

    if (ids.length === 1) {
        args.id = (new data.Ref(ids[0])).toHSZINC();
    } else {
        ids.forEach((id, idx) => {
            args['id' + idx] = (new data.Ref(id)).toHSZINC();
        });
    }

    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/hisRead',
        qs: args
    });
};


/**
 * Perform a history write request.
 *
 * @param   records     Records to be written keyed by timestamp (object)
 *                      Each record value should map the point to its value
 *                      for that time record.
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.hisWrite = function (records) {
    var cols = {}, outcols = [{name: 'ts'}];

    var rows = Object.keys(records).map(function (ts) {
        const rec = records[ts];
        var row = {ts: ts};

        Object.keys(rec).sort().forEach((id) => {
            /* Determine column */
            let col = cols[id];
            if (col === undefined) {
                col = 'v' + (outcols.length - 1);
                outcols.push({name: col, id: id});
                cols[id] = col;
            }

            /* Insert */
            row[col] = rec[id];
        });

        return row;
    }).sort((r1, r2) => {
        /*
         * This function is at the mercy of the sorting algorithm
         * so is not guaranteed to use all code paths.
         */
        if (r1.ts < r2.ts)
            return -1;
        /* istanbul ignore next */
        if (r1.ts > r2.ts)
            return 1;
        /* istanbul ignore next */
        return 0
    });

    return this._ws_hs_submit({
        method: 'POST',
        uri: '/api/hisWrite',
        body: {
            meta: {ver: '2.0'},
            cols: outcols,
            rows: rows
        }
    });
};

/* Exported symbols */
module.exports = WideSkyClient;
