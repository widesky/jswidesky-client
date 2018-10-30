/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * WideSky API Client.
 * (C) 2017 VRT Systems
 */
"use strict";

var Promise = require('bluebird'),
    request = require('request-promise'),
    rqerr = require('request-promise/errors'),
    data = require('./data');

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
 */
var WideSkyClient = function(base_uri, username,
        password, client_id, client_secret, log) {
    /* Self reference */
    var self = this;

    /*
     * HTTP library references, these may be replaced with stubs for testing.
     */
    self._request = request;
    self._rqerr = rqerr;

    /* Logger instance */
    self._log = log;

    /*
     * The authentication response, used for storing the access token and
     * refresh token.
     */
    var _ws_token = null;
    /*
     * Refresh token retrieval.  The list of waiters for a refresh token
     * add themselves here.  If `null`, then no refresh is in progress.
     */
    var _ws_token_wait = null;

    /**
     * Private method: perform a new log-in.  Returns JSON response from
     * server or raises an error.
     */
    var doLogin = function() {
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
            if (self._log) self._log.trace('Begin token acquisition');
            firstStep = doLogin();
        } else if (_ws_token.expires_in < Date.now()) {
            /* Token is expired, so do a refresh */
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
        var submit = function(token) {
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

            /* Expect JSON reply */
            options.json = true;

            if (self._log) self._log.trace('Sending request');
            return self._ws_raw_submit(options);
        };

        if (self._log) self._log.trace(options, 'Haystack request');

        return new Promise(function (resolve, reject) {
            if (self._log) self._log.trace('Need token');
            getToken().then(function (token) {
                if (self._log) self._log.trace('Got token');
                submit(token).then(resolve).catch(function (err) {
                    /* Did we get a 401? */
                    if (err instanceof self._rqerr.StatusCodeError) {
                        /* Invalidate our token then try again, *once* */
                        if (_ws_token_wait === null) {
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
 * Perform a `read` request of the WideSky API server.  This function takes
 * a filter string which is used by the server to scan matching entities.
 *
 * @param   filter      Filter expression (string)
 * @param   limit       Optional limit on the number of entities (integer)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.find = function (filter, limit) {
    var args = {
        filter: filter.toHSZINC()
    };

    if ((typeof limit) === 'number') {
        args.limit = limit.toHSZINC();
    }

    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/read',
        qs: args
    });
};


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

    /* Generate the columns */
    var cols = {};
    entities.forEach(function (entity) {
        Object.keys(entity).forEach(function (col) {
            cols[col] = true;
        });
    });

    /* Make sure we have an ID, we will put that value in first */
    if (!cols.id) {
        if (this._log) this._log.trace(entities, 'Entities lacks id column');
        throw new Error('id is missing');
    }
    delete cols['id'];

    /* Sort the columns alphabetically, then put 'id' at the start */
    cols = Object.keys(cols).sort();
    cols.unshift('id');

    return this._ws_hs_submit({
        method: 'POST',
        uri: '/api/' + op,
        body: {
            meta: {ver: '2.0'},
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
 * Delete one or more entities given as IDs.
 *
 * @param   ids     Entity IDs, either a single ID or an array.  (string or
 *                  array of strings)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.deleteById = function(ids) {
    if (((typeof ids) === 'string') || (ids.length === 1)) {
        if (!((typeof ids) === string)) {
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
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.deleteByFilter = function (filter) {
    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/deleteRec',
        qs: {
            filter: '"' + filter + '"'
        }
    });
};


/**
 * Perform a history read request.
 *
 * @param   id          Entity to read (string)
 * @param   range       Desired read range, may be given as:
 *                          (string) Raw Project Haystack range string
 *                          (object) A range object given as
 *                                   {from: TIME, to: TIME}
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.hisRead = function (id, range) {
    if (typeof range === 'object') {
        range = '"' + range.from + ',' + range.to + '"';
    }

    return this._ws_hs_submit({
        method: 'GET',
        uri: '/api/hisRead',
        qs: {
            id: (new data.Ref(id)).toHSZINC(),
            range: range
        }
    });
};

/**
 * Perform a history write request.
 *
 * @param   id          Entity to write (string)
 * @param   records     Records to be written keyed by timestamp (object)
 * @returns Promise that resolves to the raw grid.
 */
WideSkyClient.prototype.hisWrite = function (id, records) {
    var rows = Object.keys(records).map(function (ts) {
        return {ts: ts, val: records[ts]};
    });

    return this._ws_hs_submit({
        method: 'POST',
        uri: '/api/hisWrite',
        body: {
            meta: {ver: '2.0', id: (new data.Ref(id)).toHSJSON()},
            cols: [
                {name: 'ts'},
                {name: 'val'}
            ],
            rows: rows
        }
    });
};

/* Exported symbols */
module.exports = WideSkyClient;
