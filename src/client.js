/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

const data = require('./data');
const replace = require('./graphql/replace');
const moment = require('moment-timezone');
const fs = require('fs');
const FormData = require('form-data');
const socket = require('socket.io-client');
const { RequestError } = require("./errors");
const bunyan = require("bunyan");
const {CLIENT_SCHEMA} = require("./utils/evaluator");
let axios;

// Browser/Node axios import
if (typeof window === 'undefined') {
    // node process
    axios = require('axios');
}
else {
    // browser process
    // special case for commonJS as found from this issue
    // https://github.com/axios/axios/issues/5038#:~:text=Since%20the%20latest,stated%20in%20README
    axios = require('axios').default;
}
const { isAxiosError } = axios;

/** Special columns, these will be placed in the given order */
const SPECIAL_COLS = ['id', 'name', 'dis'];
const MOMENT_FORMAT_MS_PRECISION = 'YYYY-MM-DDTHH:mm:ss.SSS\\Z';


/**
 * Authentication methods supported for creating new users.
 */
const AUTH_METHOD = Object.freeze({
    /**
     * Authentication with locally-stored credentials using OAuth2 password grants.
     */
    LOCAL: 'local',
    /**
     * Authentication with locally-stored credentials using Salted Challenge-Response Authentication
     * Mechanism.
     */
    SCRAM: 'scram'
});


class WideSkyClient {
    base_uri
    #username
    #password
    #clientId
    #clientSecret
    #accessToken
    #logger
    /**
     * If this is true (default) then all http requests made by the client
     * will have the 'Accept-Encoding' header with value of 'gzip, deflate'
     * append to it.
     */
    _acceptGzipEncoding
    _impersonate        // The user id which the original user is impersonating as.

    /**
     * Constructor for WideSky Client
     * @param baseUri URI to access the WideSky API (excluding /api)
     * @param username Username of the WideSky user to authenticate with.
     * @param password Password of the WideSky user to authenticate with.
     * @param clientId Client ID for OAuth 2.0 authentication.
     * @param clientSecret Client secret for OAuth 2.0 authentication.
     * @param logger A Bunyan logging instance.
     * @param accessToken A valid WideSky access token.
     * @param options A Object containing attributes "axios" and "client" for configuring the axios and WideSky client
     *                respectively. Axios configurations are described at https://axios-http.com/docs/config_defaults.
     */
    constructor(baseUri,
                username,
                password,
                clientId,
                clientSecret,
                logger,
                accessToken,
                options={}) {
        this.baseUri = baseUri;
        this.#username = username;
        this.#password = password;
        this.#clientId = clientId;
        this.#clientSecret = clientSecret;
        this.#accessToken = accessToken;
        this.#logger = logger;
        this.options = options;
        this.clientOptions = null;
        this._impersonate = null;
        this._acceptGzipEncoding  = true;
        this.initialised = false;

        this.initAccessToken();
        this.initAxios();
        // Client option initiator is async. Wait for this to complete before submitting requests
        this.initWaitFor = this.initClientOptions();
    }

    /**
     * Create a WideSky client from a given set of configurations
     * @param config An Object defining the configurations for the WideSkyClient. Requires attributes serverURL,
     *               username, password, clientId, clientSecret. Optional attributes are logger, accessToken and
     *               options. If no logger is specified, a Bunyan logging instance will be created.
     * @returns {WideSkyClient} A WideSky client instance.
     */
    static makeFromConfig(config={}) {
        const requiredProps = [
            "serverURL",
            "username",
            "password",
            "clientId",
            "clientSecret"
        ];
        for (const prop of requiredProps) {
            if (config[prop] === undefined) {
                throw new Error(`Configuration parameter requires properties ${requiredProps.join(", ")}`);
            }
        }

        const {
            serverURL,
            username,
            password,
            clientId,
            clientSecret,
            accessToken,
            options
        } = config;
        let { logger } = config;

        if (logger === undefined) {
            logger = bunyan.createLogger({
                name: "WideSky-Client"
            });
        }

        return new WideSkyClient(
            serverURL,
            username,
            password,
            clientId,
            clientSecret,
            logger,
            accessToken,
            options
        );
    }

    /**
     * Initialise the Client access token
     */
    initAccessToken() {
        /*
         * The authentication response, used for storing the access token and
         * refresh token.
         */
        this._ws_token = null;
        /*
         * Refresh token retrieval. The list of waiters for a refresh token
         * add themselves here. If `null`, then no refresh is in progress.
         */
        this._ws_token_wait = null;

        if (this.#accessToken) {
            for (const tokenProp of ['refresh_token', 'expires_in', 'token_type', 'access_token']) {
                if (this.#accessToken[tokenProp] === undefined) {
                    throw new Error(`Parameter 'accessToken' is not a valid WideSky token.`);
                }
            }
            this._ws_token = this.#accessToken;
        }
    }

    /**
     * Apply the config to be used for all axios requests.
     */
    initAxios() {
        this.axios = axios.create(Object.assign({
            baseURL: this.baseUri
        }, this.options.axios || {}));
    }

    /**
     * Initialise the WideSkyClient with the user configurations.
     * @returns {Promise<void>}
     */
    async initClientOptions() {
        try {
            await CLIENT_SCHEMA.validate(this.options.client);
            this.clientOptions = CLIENT_SCHEMA.cast(this.options.client);
            this.setAcceptGzip(this.clientOptions.acceptGzip);

            if (this.clientOptions.impersonateAs !== null) {
                this.impersonateAs(this.clientOptions.impersonateAs);
            }

            this.initialised = true;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * Perform a log-in, if not already done.  This does a `getToken` whilst
     * performing no further operations.
     */
    login() {
        return this.getToken();
    };

    impersonateAs(userId) {
        if (!this.initialised) {
            const oldPromise = this.initWaitFor;
            this.initWaitFor = new Promise(async (resolve) => {
                await oldPromise;
                this._impersonate = userId;
            });
        } else {
            this._impersonate = userId;
        }
    };

    isImpersonating() {
        return this._impersonate !== null;
    };

    unsetImpersonate() {
        this._impersonate = null;
    };

    setAcceptGzip(acceptGzip) {
        this._acceptGzipEncoding = Boolean(acceptGzip);
    }

    isAcceptingGzip() {
        return this._acceptGzipEncoding;
    }

    /**
     * Protected method for submitting requests against the API server with Axios.
     * @param method Request method to be performed. Not case-sensitive.
     * @param uri Endpoint to for request to be sent, relative to the base URI given to the client.
     * @param body Body of the request. Ignored if given method is "GET".
     * @param config Request config to be applied. Refer to https://www.npmjs.com/package/axios#request-config for
     * more info.
     * @returns Data from response of request.
     */
    async _wsRawSubmit(method, uri, body, config) {
        if (!this.initialised) {
            this.#logger.info("Not finished initialising. Waiting...");
            await this.initWaitFor;
        }

        /* istanbul ignore next */
        if (this.#logger) {
            this.#logger.trace(config, 'Raw request');
        }

        let res;
        switch (method.toUpperCase()) {
            case 'GET':
                res = await this.axios.get(uri, config);
                break;
            case 'POST':
                res = await this.axios.post(uri, body, config);
                break;
            case 'PATCH':
                res = await this.axios.patch(uri, body, config);
                break;
            case 'PUT':
                res = await this.axios.put(uri, body, config);
                break;
            default:
                throw new Error(`Not configured for method ${method}.`);
        }

        return res.data;
    };

    /**
     * Attach necessary headers to request config.
     * @param config Existing config to add to.
     * @returns Modified config.
     */
    async _attachReqConfig(config) {
        const token = await this.getToken();

        config = Object.assign({}, config);       // make a copy
        if (config.headers === undefined) {
            config.headers = {};
        }

        config.headers['Authorization'] = 'Bearer ' + token.access_token;
        config.headers['Accept'] = 'application/json';

        if (this.isAcceptingGzip()) {
            config.decompress = true;
        }

        if (this.isImpersonating()) {
            config.headers['X-IMPERSONATE'] = this._impersonate;
        }

        return config;
    }

    async submitRequest(method, uri, body={}, config={}) {
        config = await this._attachReqConfig(config);

        try {
            return await this._wsRawSubmit(method, uri, body, config);
        }
        catch (err) {
            if (isAxiosError(err)) {
                if (err.response) {
                    // response has been received from API server
                    if (err.response.status === 401 && this._ws_token) {
                        // If error is 401, then get new token
                        this._ws_token = null;
                        config = await this._attachReqConfig(config);
                        return this._wsRawSubmit(method, uri, body, config);
                    }
                    else {
                        throw RequestError.make(err);
                    }
                }
                else {
                    throw err;
                }
            }
            else {
                throw err;
            }
        }
    }

    /**
     * Private method: perform a new log-in.  Returns JSON response from
     * server or raises an error.
     */
    _doLogin() {
        /* istanbul ignore next */
        if (this.#logger) {
            this.#logger.trace('Performing login attempt');
        }

        return this._wsRawSubmit(
            'POST',
            '/oauth2/token',
            {
                username: this.#username,
                password: this.#password,
                grant_type: 'password'
            },
            {
                auth: {
                    username: this.#clientId,
                    password: this.#clientSecret
                }
            }
        );
    };

    /**
     * Private method: refresh a token. Returns JSON response from server or
     * raises an error. Requires that _ws_token is not null.
     */
    _doRefresh() {
        /* istanbul ignore next */
        if (this.#logger) this.#logger.trace('Performing token refresh attempt');

        return this._wsRawSubmit(
            'POST',
            '/oauth2/token',
            {
                refresh_token: this._ws_token.refresh_token,
                grant_type: 'refresh_token'
            },
            {
                auth: {
                    username: this.#clientId,
                    password: this.#clientSecret
                }
            }
        );
    };

    _getTokenSuccess(token, resolve) {
        /* istanbul ignore next */
        if (this.#logger) {
            this.#logger.info('Logged in to API server');
        }
        this._ws_token = token;

        const waiters = this._ws_token_wait;

        this._ws_token_wait = null;
        resolve(token);
        waiters.forEach(function (waiter) {
            waiter.resolve(token);
        });
    }

    _getTokenFail(err, reject) {
        /* istanbul ignore next */
        if (this.#logger) {
            this.#logger.warn(err, 'Failed to log into API server');
        }
        this._ws_token = null;

        const waiters = this._ws_token_wait;

        this._ws_token_wait = null;
        reject(err);
        waiters.forEach(function (waiter) {
            waiter.reject(err);
        });
    }

    /**
     * Private method: retrieve the access token.  This performs a login if
     * the current token is absent or attempts a refresh if expired.
     */
    getToken() {
        let firstStep;
        let refresh = false;

        /* Is a request in progress? */
        if (this._ws_token_wait !== null) {
            /* Join the queue */
            /* istanbul ignore next */
            if (this.#logger) {
                this.#logger.trace('Waiting for token acquisition');
            }

            return new Promise( (resolve, reject) => {
                this._ws_token_wait.push({
                    resolve: resolve,
                    reject: reject
                });
            });
        }

        if (this._ws_token === null) {
            /* No token, so acquire one */
            this._ws_token_wait = [];
            /* istanbul ignore next */
            if (this.#logger) {
                this.#logger.trace('Begin token acquisition');
            }

            firstStep = this._doLogin();
        }
        else if (this._ws_token.expires_in < Date.now()) {
            /* Token is expired, so do a refresh */
            /* istanbul ignore next */
            if (this.#logger) {
                this.#logger.trace('Begin token refresh');
            }

            this._ws_token_wait = [];
            firstStep = this._doRefresh();
            refresh = true;
        }
        else {
            return this._ws_token;
        }

        return new Promise( async (resolve, reject) => {
            return firstStep
                .then((token) => this._getTokenSuccess(token, resolve))
                .catch((err) => {
                    /* If we're refreshing, try a full log-in */
                    if (refresh) {
                        /* istanbul ignore next */
                        if (this.#logger) {
                            this.#logger.info(
                                err,
                                'Refresh fails, trying log-in instead'
                            );
                        }
                        return this._doLogin()
                            .then((token) => this._getTokenSuccess(token, resolve))
                            .catch((err) => this._getTokenFail(err, reject));
                    }
                    else {
                        return this._getTokenFail(err, reject);
                    }
                });
        });
    };

    /**
     * Perform an operation given by the uri with argument ids. Ids can either be a String or an array of String's.
     * @param ids Entity id/s for the operation to be performed on.
     * @param uri API endpoint to perform the operation.
     * @returns {Promise<*>}
     */
    _opByIds(ids, uri) {
        if (typeof ids === 'string' || (Array.isArray(ids) && ids.length === 1)) {
            const id = Array.isArray(ids) ? ids[0] : ids;

            return this.submitRequest(
                'GET',
                uri,
                {},
                {
                    params: {
                        id: (new data.Ref(id)).toHSZINC()
                    }
                }
            );
        }
        else if (Array.isArray(ids)) {
            if (ids.length > 1) {
                // verify input is all strings
                for (const id of ids) {
                    if (!(typeof id === 'string')) {
                        if (id instanceof Object) {
                            // check if its compatible with class Ref
                            try {
                                new data.Ref(id);
                            }
                            catch (error) {
                                throw new Error(
                                    `Parameter 'ids' contains an element that is of type object but not compatible ` +
                                    `with class Ref due to: ${error.message}`
                                );
                            }
                        } else {
                            throw new Error(
                                `Parameter 'ids' contains an element that is not a string. Found ${typeof id}.`
                            );
                        }
                    }
                }

                return this.submitRequest(
                    'POST',
                    uri,
                    {
                        meta: {
                            ver: '2.0',
                        },
                        cols: [
                            {name: 'id'}
                        ],
                        rows: ids.map(function (id) {
                            return {id: (new data.Ref(id)).toHSJSON()};
                        })
                    });
            } else {
                throw new Error(`An empty array of id's was given.`);
            }
        } else {
            throw new Error(`Parameter 'ids' is neither a single id or an array of id's.`);
        }
    }

    /**
     * Perform a filter operation, conducting the necessary checks before doing so.
     * @param op Operation to be completed
     * @param filter Filter to be used.
     * @param limit Limit to be used.
     * @returns {Promise<*>} Result of API call.
     */
    _byFilter(op, filter, limit) {
        if (limit < 0) {
            throw new Error('Invalid negative limit given.');
        }

        if (typeof filter !== 'string') {
            throw new Error(`Invalid filter type ${typeof filter} given. Expected string.`);
        }

        return this.submitRequest(
            "GET",
            `/api/${op}`,
            {},
            {
                params: {
                    filter,
                    limit
                }
            }
        )
    }

    /**
     * Perform a `read` request of the WideSky API server.  This function takes
     * one or more IDs expressed as a list.
     *
     * @param   ids     Entity IDs, either a single ID or an array.  (string or
     *                  array of strings)
     * @returns Promise that resolves to the raw grid.
     */
    read(ids) {
        return this._opByIds(ids, '/api/read');
    };

    /**
     * Perform a graphql request to the WideSky API server.
     * This function takes in a string which contains the
     * graph query.
     *
     * @param   graphql The graph query
     * @returns Promise that resolves to the graphql response.
     */
    query(graphql) {
        graphql = replace.outerBraces(graphql);

        let body = { 'query': graphql }

        return this.submitRequest(
            'POST',
            '/graphql',
            body
        );
    }

    /**
     * Perform a `read` request of the WideSky API server.  This function takes
     * a filter string which is used by the server to scan matching entities.
     *
     * @param   filter      Filter expression (string)
     * @param   limit       Optional limit on the number of entities (integer)
     * @returns Promise that resolves to the raw grid.
     */
    find(filter, limit=0) {
        return this._byFilter('read', filter, limit);
    };

    /**
     * Perform a cache reload request of the WideSky API server.
     * @returns Promise that resolves to the raw grid.
     */
    reloadCache() {
        return this.submitRequest(
            'GET',
            '/api/reloadAuthCache'
        );
    };

    /**
     * Create or Update one or more entities.
     *
     * @param   op          Operation to perform
     * @param   entities    Array of entity objects
     * @returns Promise that resolves to the raw grid.
     */
    _create_or_update(op, entities) {
        if (!(Array.isArray(entities))) {
            entities = [entities];
        }

        /* Generate the columns, make a note of the haystack version needed */
        let cols = [], present = {}, ver = '2.0';

        entities.forEach(function (entity) {
            Object.keys(entity).forEach(function (col) {
                if (!present[col]) {
                    present[col] = true;
                }

                /* Upgrade to Haystack 3.0 */
                if (Array.isArray(entity[col])) {
                    ver = '3.0';
                }
            });
        });

        /* Ensure updateRec lists `id` */
        if ((!present.id) && (op === 'updateRec')) {
            /* istanbul ignore next */
            if (this.#logger) {
                this.#logger.trace(entities, 'Entities lacks id column');
            }

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
        cols = [...cols, ...(Object.keys(present).sort())];

        return this.submitRequest(
            'POST',
            `/api/${op}`,
            {
                meta: {ver: ver},
                cols: cols.map(function (c) {
                    return {name: c};
                }),
                rows: entities
            }
        );
    };

    /**
     * Create one or more entities.  This takes an array of objects and attempts
     * to create those entities in WideSky.
     *
     * @param   entities    Array of entity objects
     * @returns Promise that resolves to the raw grid.
     */
    create(entities) {
        return this._create_or_update('createRec', entities);
    };

    /**
     * Update one or more entities.  This takes an array of objects and attempts
     * to update those entities in WideSky.
     *
     * @param   entities    Array of entity objects
     * @returns Promise that resolves to the raw grid.
     */
    update(entities) {
        return this._create_or_update('updateRec', entities);
    };

    /**
     * Create a new user account.
     *
     * @param   {string}    email       Email (user name) of the new user
     * @param   {string}    name        Name (description) of the new user account,
     *                                  will become the `dis` field of the user entity.
     * @param   {string}    description Purpose of the user account, e.g. "User",
     *                                  "SuperUser", … etc.  Fills in the `primaryFunction` tag.
     * @param   {string[]}  roles       The IDs (UUIDs or names) of the `role` entities to link to
     *                                  this new user.
     * @param   {string?}   password    The new password for the user.  If set to `null` or the
     *                                  empty string, the user will be sent an email to "activate"
     *                                  their user account (and supply a password as they do so).
     * @param   {string?}   method      The authentication method for the new user.  At the time
     *                                  of writing, the choices are: "local" (the default, using
     *                                  OAuth2 authentication) and "scram" (SCRAM authentication).
     */
    createUser(email, name, description, roles, password=null, method=AUTH_METHOD.LOCAL) {
        /* istanbul ignore next */
        if (this.#logger) {
            this.#logger.trace('Creating a new user: ' + email);
        }

        if (email.length < 1) {
            throw new Error('Email cannot be empty.');
        }

        if (description.length < 1) {
            throw new Error('Description cannot be empty.');
        }

        if (Array.isArray(roles) === false) {
            throw new Error('Roles must be an array.');
        }
        else if (roles.length === 0) {
            throw new Error('At least one roles must be set.');
        }

        if (method !== AUTH_METHOD.LOCAL && method !== AUTH_METHOD.SCRAM) {
            throw new Error('Auth method can only be LOCAL or SCRAM.');
        }

        return this.submitRequest(
            'PUT', '/api/admin/user',
            {email, name, description, roles, password, method}
        );
    }

    /**
     * Change the current session user's password.
     *
     * @param   newPassword - A string
     * @returns Promise that resolves to the raw grid.
     */
    updatePassword(newPassword) {
        /* istanbul ignore next */
        if (this.#logger) {
            this.#logger.trace('Updating password');
        }

        if (!newPassword) {
            throw new Error('New password cannot be empty.');
        }

        return this.submitRequest(
            'POST',
            '/user/updatePassword',
            {
                newPassword
            }
        );
    };

    /**
     * Delete one or more entities given as IDs.
     *
     * @param   ids     Entity IDs, either a single ID or an array.  (string or
     *                  array of strings)
     * @returns Promise that resolves to the raw grid.
     */
    deleteById(ids) {
        return this._opByIds(ids, '/api/deleteRec');
    };


    /**
     * Delete entities that match a given filter string.
     *
     * @param   filter      Filter expression (string)
     * @param   limit       Optional limit on the number of entities to delete
     *                      (integer)
     * @returns Promise that resolves to the raw grid.
     */
    deleteByFilter(filter, limit=0) {
        return this._byFilter('deleteRec', filter, limit);
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
     * @param   batchSize    (Number)    Optional batch size when reading multiple
     *                                  points.  Some environments may experience
     *                                  issues reading more than a few dozen points
     *                                  at a time due to HTTP request payload
     *                                  restrictions, so bigger reads will be
     *                                  broken up into 50-point groups.
     *                                  The size can be tuned here.
     *
     * @returns Promise that resolves to the raw grid.
     */
    hisRead(ids, from, to, batchSize=50) {
        let range;

        if (to !== undefined) {
            /* Full range given, both from and to *must* be Dates */
            if (!(from instanceof Date)) {
                throw new Error('`from` is not a Date');
            }

            if (!(to instanceof Date)) {
                throw new Error('`to` is not a Date');
            }

            range = from.toHSZINC() + ',' + to.toHSZINC();
        }
        else {
            range = from;
        }

        if (!(Array.isArray(ids))) {
            ids = [ids];
        }

        /* Format the range */
        range = range.toHSZINC();

        /* Normalise the IDs into standard form */
        ids = ids.map(function (id) {
            return (new data.Ref(id)).toHSJSON();
        });

        if (ids.length < batchSize) {
            /* Small hisRead, handle as normal */
            return this._hisRead(ids, range);
        }

        /* Group the IDs into blocks */
        const reads = [];
        let offset = 0;

        while (offset < ids.length) {
            const block = ids.slice(offset, offset + batchSize);

            reads.push(block);
            offset += block.length;
        }

        /* Assemble the overall result */
        const result = {
            meta: {
                ver: '2.0',
                hisStart: null,
                hisEnd: null
            },
            cols: [
                {name: 'ts'}
            ],
            rows: []
        };

        const status = {
            hisStart: null,
            hisEnd: null,
            rowTs: {},
            colId: {}
        };

        /* Enumerate the columns */
        for (let i = 0; i < ids.length; i++) {
            status.colId[ids[i]] = i;
            result.cols.push({
                name: 'v' + i,
                id: ids[i]
            });
        }

        /* Execute the reads */
        return Promise.all(
            reads.map((block_ids) => {
                return this._hisRead(block_ids, range).then((block_res) => {
                    this._mergeHisReadRes(result, status, block_ids, block_res);
                });
            })
        ).then(() => {
            /* Assemble all the rows */
            let times = Object.keys(status.rowTs).map((ts) => {
                return parseInt(ts);
            });
            times.sort();

            result.rows = times.map(function (ts) {
                return status.rowTs[ts];
            });

            /* Return the merged result */
            return result;
        });
    };

    _mergeHisReadRes(result, status, blockIds, blockRes) {
        /* Merge the header */

        let this_start = data.parse(blockRes.meta.hisStart);
        let this_end = data.parse(blockRes.meta.hisEnd);

        /*
         * Defensive programming: docs say hisStart/hisEnd can be 'm:'
         * and we really shouldn't "trust" the inputs in something
         * that comes from "outside" anyway.
         */

        if ((this_start != null) && (this_start instanceof Date)) {
            /* Is this_start earlier than status.hisStart? */
            this_start = this_start.valueOf();
            if ((status.hisStart == null) || (status.hisStart > this_start)) {
                status.hisStart = this_start;
                result.meta.hisStart = blockRes.meta.hisStart;
            }
        }

        if ((this_end != null) && (this_end instanceof Date)) {
            /* Is this_end later than status.hisStart? */
            this_end = this_end.valueOf();
            if ((status.hisEnd == null) || (status.hisEnd < this_end)) {
                status.hisEnd = this_end;
                result.meta.hisEnd = blockRes.meta.hisEnd;
            }
        }

        /* Are there other fields to merge?  (for future expansion) */

        for (const field in blockRes.meta) {
            if (!result.meta.hasOwnProperty(field)) {
                result.meta[field] = blockRes.meta[field];
            }
        }

        /* Now, merge the data */

        for (let r = 0; r < blockRes.rows.length; r++) {
            const in_row = blockRes.rows[r];
            let ts = data.parse(in_row.ts);

            /* Sanity check, `ts` must be a Date */
            if ((ts == null) || !(ts instanceof Date)) {
                throw new Error(
                    'Expected date/time for ts column, got: ' + in_row.ts
                );
            }

            /* Extract ms time */
            ts = ts.valueOf();
            let out_row;

            if (status.rowTs.hasOwnProperty(ts)) {
                out_row = status.rowTs[ts];
            }
            else {
                out_row = {ts: in_row.ts};
                status.rowTs[ts] = out_row;
            }

            /* Copy the columns in */
            for (let c = 0; c < blockIds.length; c++) {
                const val = in_row['v' + c];

                if (val != null) {
                    const id = blockIds[c];
                    const col = status.colId[id];

                    if (col == null) {
                        throw new Error('Unexpected ID ' + id);
                    }

                    out_row['v' + col] = val;
                }
            }
        }
    };

    _hisRead(ids, range) {
        const config = {
            params: {
                range
            }
        };

        if (ids.length === 1) {
            config.params.id = (new data.Ref(ids[0])).toHSZINC();
        }
        else {
            ids.forEach((id, idx) => {
                config.params['id' + idx] = (new data.Ref(id)).toHSZINC();
            });
        }

        return this.submitRequest(
            'GET',
            '/api/hisRead',
            {},
            config
        );
    };

    /**
     * Perform a history write request.
     *
     * @param   records     Records to be written keyed by timestamp (object)
     *                      Each record value should map the point to its value
     *                      for that time record. Records should have the format of:
     *                      {
     *                          <time>: {
     *                              <id>: <valueToBeWritten>,
     *                              ...
     *                          },
     *                          ...
     *                      }
     *                      where each of the '<>' values are in HayStack format.
     * @returns Promise that resolves to the raw grid.
     */
    hisWrite(records) {
        const cols = {}, outCols = [{name: 'ts'}];
        const rows = Object.keys(records).map(function (ts) {
            const rec = records[ts];
            const row = {ts: ts};

            Object.keys(rec).sort().forEach((id) => {
                /* Determine column */
                let col = cols[id];
                if (col === undefined) {
                    col = 'v' + (outCols.length - 1);
                    outCols.push({name: col, id: id});
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

        return this.submitRequest(
            'POST',
            '/api/hisWrite',
            {
                meta: {ver: '2.0'},
                cols: outCols,
                rows: rows
            }
        );
    };

    /**
     *
     * @param id (string) Identifier of the object point.
     * @param ts (string) Timestamp which the upload will perform against the object point.
     * @param file (string|buffer) The upload target, this can either be an absolute file path or a buffer.
     * @param filename (string) Name of the upload.
     * @param mediaType (string) Media type of the upload. (e.g. pdf = application/pdf)
     * @param inlineRetrieval (boolean) Optional. When true, client that supports the HTTP header contentDisposition will
     *                                 render the uploaded file on the screen instead of presenting the
     *                                 'Save as' dialog. If nothing is set then true is assumed.
     * @param cacheMaxAge (number) Optional. The number of seconds a client, that supports the HTTP header CacheMaxAge,
     *                             should store the retrieved file (stored in this op)
     *                             in cache before re-downloading it again.
     * @param force (boolean) Optional. When true, the server will forcefully overwrite a previously stored file that shares
     *                        the same given ts. Default is false.
     * @param tags (object) Optional. An object consisting of additional file tags that will go with the upload.
     *                      Key of the object is the tagName while value is its tagValue.
     *                      E.g. { 'UploadedBy': 'AuthorABC'}
     */
    fileUpload (id,
                ts,
                file,
                filename,
                mediaType,
                inlineRetrieval=true,
                cacheMaxAge=1800,       // 30 minutes
                force=false,
                tags={}) {

        if (typeof file === 'string') {
            // Assume an absolute file path
            file = fs.createReadStream(file);
        }
        else if (Buffer.isBuffer(file)) {
            // buffer is ok
        }
        else {
            throw new Error('File can only be a buffer or an absolute file path (string).');
        }

        if (typeof filename !== 'string') {
            throw new Error('File name must be a string.');
        }

        if (typeof force !== 'boolean') {
            throw new Error('Force must be of type boolean.');
        }

        if (typeof inlineRetrieval !== 'boolean') {
            throw new Error('InlineRetrieval must be of type boolean.');
        }

        if (typeof cacheMaxAge !== 'number') {
            throw new Error('CacheMaxAge must be of type number.');
        }
        else {
            if (cacheMaxAge < 0) {
                throw new Error('CacheMaxAge must be more than or equals to 0.');
            }
        }

        if (typeof tags !== 'object') {
            throw new Error(`Tags must be an object not ${typeof tags}.`);
        }

        const requestTags = [];

        const tagKeys = Object.keys(tags);
        for (let index = 0; index < tagKeys.length; index++) {
            const tagKey = tagKeys[index];
            const tagVal = tags[tagKey];

            if (typeof tagVal !== 'string') {
                throw new Error('Tag value for key ' + tagKey + ' must be string.');
            }

            requestTags.push(`${tagKey}=${tagVal}`);
        }

        let contentDisposition = inlineRetrieval ? 'inline': 'attachment';
        if (!inlineRetrieval && filename) {
            // e.g. attachment; filename="myPDF.pdf"
            contentDisposition += '; filename="' + filename + "'";
        }

        // Create form
        const formData = new FormData();
        const form = {
            'id': id,
            'ts': ts,
            'data': file,
            'force': force.toString(),
            'cacheMaxAge': cacheMaxAge.toString(),
            'contentDisposition': contentDisposition,
            'tags': JSON.stringify(requestTags)
        };

        for (const [key, value] of Object.entries(form)) {
            if (key === 'data') {
                // formdata needs to know the mimetype of the File or Buffer
                // the mimetype is derived automatically by looking at the given filename.
                // MimeType is required or otherwise it will be disregarded and not sent to API server
                formData.append(key, value, {
                    filename,
                    'contentType': mediaType
                });
            }
            else {
                formData.append(key, value);
            }
        }

        return this.submitRequest(
            'PUT',
            '/api/file/storage',
            formData,
            {
                headers: {
                    'content-type': 'multipart/form-data'
                }
            }
        );
    }

    /**
     * Retrieve a previously stored file the configured WideSky server.
     * This API will return an object keyed by the requested point ids,
     * where the value is an array of file URLs which can be used to retrieve
     * the file data via the HTTP GET method.
     *
     * Date inputs for this function is the standard ISO8601 dates.
     * Examples:
     * 2022-03-30T11:30:00Z
     * 2022-07-26T11:00:00+02:00
     *
     * @param   pointIds      (string)    The file point identifier, one with kind=File
     *                        (array)     An array of file point identifiers in string.
     * @param   from          (date)      Starting ISO8601 timestamp of the retrieve.
     * @param   to            (date)      Ending ISO8601 timestamp of the retrieve.
     * @param   presigned     (boolean)   Flag for indicating if the returned URL should be presigned.
     * @param   presignExpiry (number)    Duration in seconds where the presigned link will expire.
     *
     *
     * @returns Promise that resolves to the following format.
     * [
     *     {
     *         pointId: c7bd64d9-0a72-4584-945a-c667081c97f6,
     *         urls: [
     *             time: 2087911800,
     *             value: https://abc.on.widesky.cloud/api/file/storage/2087911800_zxcvbn...
     *         ]
     *     }
     * ]
     */
    fileRetrieve(pointIds, from, to, presigned=true, presignExpiry=1800) {
        if (!(Array.isArray(pointIds))) {
            if (typeof pointIds !== 'string') {
                throw new Error(`Point id ${pointIds} must be a string.`);
            } else {
                pointIds = [pointIds];
            }
        }
        else {
            for (let index = 0; index < pointIds.length; index++) {
                if (typeof pointIds[index] !== 'string') {
                    throw new Error('Point id ' + pointIds[index] + ' must be string.');
                }
            }
        }

        const mFrom = moment(from);
        if (mFrom.isValid() !== true) {
            throw new Error('From date ' + from + ' is not a valid date.');
        }

        const mTo = moment(to);
        if (mTo.isValid() !== true) {
            throw new Error('To date ' + from + ' is not a valid date.');
        }

        if (mFrom.valueOf() === mTo.valueOf()) {
            // User probably meant at the point in time.
            // Push the 'to' datetime by 1 ms later so WideSky will match something, otherwise
            // such query is going to return nothing.
            mTo.add(1, 'ms');
        }

        if (typeof presigned !== 'boolean') {
            throw new Error('Presigned flag must be a boolean value.');
        }
        else if (presigned === true) {
            if (typeof presignExpiry !== 'number') {
                throw new Error('PresignExpiry value ' + presignExpiry + ' must be a number');
            }
            else if (presignExpiry < 0) {
                throw new Error('PresignExpiry value ' + presignExpiry + ' must be greater than zero.');
            }
        }

        return this.submitRequest(
            'GET',
            '/api/file/storage',
            {},
            {
                params: {
                    pointIds: JSON.stringify(pointIds),
                    from: mFrom.utc().format(MOMENT_FORMAT_MS_PRECISION),
                    to: mTo.utc().format(MOMENT_FORMAT_MS_PRECISION),
                    presigned: presigned.toString(),
                    presignExpiry: presignExpiry.toString()
                }
            }
        );
    }

    /**
     * Initiate a haystack watchSub op based on the given list of point ids
     * @param {*} pointIds String or Array. The point Ids to perform watchSub on.
     * @param {string} lease Duration (ms) the watch will exist
     * @param {string} description A short description for the watch session
     * @param {Object} config Configuration options used in `submitRequest()`
     * @returns Promise that resolves to a watch object.
     */
    watchSub(pointIds, lease, description, config = {}) {
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
    watchExtend(watchId, pointIds, lease, config = {}) {
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
    watchUnsub(watchId, deletePointIds, close = true, config = {}) {
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
     * @param {string} watchId the watch ID string.
     * @returns a socket.io Socket object.
     */
    getWatchSocket(watchId) {
        const tokens = this.getToken();
        const accessToken = tokens.access_token;

        const url = `${this.base_uri}/${watchId}`;

        return socket.connect(url, {
            query: { Authorization: accessToken },
            'force new connection': true,
            autoConnect: false
        });
    }

    /**
     * Perform a history delete request.
     * @param {*} ids An array of point entity UUIDs for the delete operations or a single string.
     * @param {String} range A valid hisRead range string.
     * @returns Promise that resoves into haystack response grid.
     */
    hisDelete(ids, range) {
        // If id was given as string, put in array.
        if (!Array.isArray(ids)) {
            ids = [ids];
        }

        if (!(ids.length > 0)) {
            throw new Error('`ids` must contain at least one point UUID.');
        }

        // Validate the range
        const range_err = 'An invalid hisRead range input was given: ';
        if (!range.startsWith('s:')) {
            throw new Error(range_err + 'Missing `s:`.');
        }

        const range_val = range.replace('s:', '');
        if (range_val === '') {
            throw new Error(range_err + 'No range was given.');
        }

        if (!(range_val === 'last' ||
              range_val === 'first' ||
              range_val === 'today' ||
              range_val === 'yesterday')) {

            if (range_val.includes(',')) {
                const ranges = range_val.split(',');

                // Should not be more or less than 2 date(time) values in a range.
                if (ranges.length != 2) {
                    throw new Error(range_err + 'Number of timestamps cannot exceed 2.');
                }

                for (const ts in ranges) {
                    if (ranges[ts].includes(' ')) {
                        ranges[ts] = ranges[ts].trimStart().split(' ')[0];
                    }
                    if (!moment(ranges[ts].trim(), moment.ISO_8601).isValid()) {
                        throw new Error(range_err + 'Invalid ISO8601 timestamp.');
                    }
                }

            } else {
                if (!moment(range_val, moment.ISO_8601).isValid()) {
                    throw new Error(range_err + 'Invalid ISO8601 timestamp.');
                }
            }
        }

        // Normalise the IDs into standard form
        ids = ids.map(function (id) {
            return new data.Ref(id).toHSJSON();
        });

        // Build request body
        const payload = {
            meta: {
                ver: '2.0',
            },
            cols: [
                {
                    name: 'range',
                },
            ],
            rows: [
                {
                    range: range,
                },
            ],
        };

        if (ids.length === 1) {
            payload.rows[0].id = new data.Ref(ids[0]).toHSJSON();
            payload.cols.push({name: 'id'});
        } else {
            ids.forEach((id, idx) => {
                payload.rows[0]['id' + idx] = new data.Ref(id).toHSJSON();
                payload.cols.push({name: 'id' + idx});
            });
        }

        return this.submitRequest('POST', '/api/hisDelete', payload, {});
    }
}

/* Exported symbols */
module.exports = WideSkyClient;
