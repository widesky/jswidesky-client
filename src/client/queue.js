/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Outbound request queue for jswidesky-client. Opt-in via
 * options.client.queue. Hand-rolled FIFO with concurrency cap, minimum
 * inter-dispatch delay, hard maxQueueDepth refuse, and a module-level
 * registry keyed by login identity for perToken sharing across
 * WideSkyClient instances.
 */
'use strict';

const yup = require('yup');
const { QueueFullError } = require('../errors');

class RequestQueue {
    constructor(opts, logger) {
        this._opts               = opts;        // retained for registry config-mismatch comparison
        this._maxConcurrent      = opts.maxConcurrent;
        this._minDelayMs         = opts.minDelayMs;
        this._maxQueueDepth      = opts.maxQueueDepth;
        this._highWaterMark      = Math.ceil(opts.maxQueueDepth * opts.highWaterPct);
        this._highWaterLogEveryN = opts.highWaterLogEveryN;
        this._logger             = logger;

        this._queue                 = [];
        this._inFlight              = 0;
        this._lastDispatchAt        = -Infinity;
        this._highWaterHitsSinceLog = 0;
        this._drainScheduled        = false;
    }

    add(fn) {
        if (this._queue.length >= this._maxQueueDepth) {
            return Promise.reject(new QueueFullError(
                `Request queue is full (depth ${this._maxQueueDepth} reached). ` +
                `Reduce request rate or increase maxQueueDepth.`,
                { depth: this._maxQueueDepth, inFlight: this._inFlight }
            ));
        }
        if (this._queue.length >= this._highWaterMark) {
            this._maybeLogHighWater();
        }
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
            this._drain();
        });
    }

    _maybeLogHighWater() {
        this._highWaterHitsSinceLog++;
        if (this._highWaterHitsSinceLog >= this._highWaterLogEveryN) {
            this._logger.warn(
                {
                    queueDepth: this._queue.length,
                    maxQueueDepth: this._maxQueueDepth,
                    inFlight: this._inFlight,
                    highWaterMark: this._highWaterMark,
                },
                'jswidesky-client: request queue at high-water mark'
            );
            this._highWaterHitsSinceLog = 0;
        }
    }

    _drain() {
        if (this._drainScheduled) return;
        while (this._inFlight < this._maxConcurrent && this._queue.length > 0) {
            const sinceLast = Date.now() - this._lastDispatchAt;
            if (this._minDelayMs > 0 && sinceLast < this._minDelayMs) {
                this._drainScheduled = true;
                setTimeout(() => {
                    this._drainScheduled = false;
                    this._drain();
                }, this._minDelayMs - sinceLast);
                return;
            }
            const item = this._queue.shift();
            this._inFlight++;
            this._lastDispatchAt = Date.now();
            Promise.resolve()
                .then(item.fn)
                .then(item.resolve, item.reject)
                .finally(() => {
                    this._inFlight--;
                    this._drain();
                });
        }
    }
}

const QUEUE_SCHEMA = yup.object().shape({
    maxConcurrent:      yup.number().integer().min(1).default(5),
    minDelayMs:         yup.number().integer().min(0).default(0),
    maxQueueDepth:      yup.number().integer().min(1).default(1000),
    perToken:           yup.boolean().default(false),
    highWaterPct:       yup.number().min(0).max(1).default(0.8),
    highWaterLogEveryN: yup.number().integer().min(1).default(50),
}).default(undefined);

const _queueRegistry = new Map();

function makeLoginKey({ baseUri, username, clientId } = {}) {
    return `${baseUri ?? ''}\x00${username ?? ''}\x00${clientId ?? ''}`;
}

// Fields whose value defines the queue's runtime behavior. perToken is
// excluded — by the time we're here it's true on both sides by construction.
const _CONFIG_FIELDS = [
    'maxConcurrent',
    'minDelayMs',
    'maxQueueDepth',
    'highWaterPct',
    'highWaterLogEveryN',
];

function getRequestQueueForLogin(loginKey, options, logger) {
    let q = _queueRegistry.get(loginKey);
    if (!q) {
        q = new RequestQueue(options, logger);
        _queueRegistry.set(loginKey, q);
        return q;
    }
    // Registry hit: existing queue wins. Warn if the second caller's config
    // diverges from what's already cached, since silent inheritance is the
    // exact surprise an opt-in throttle is meant to prevent.
    const mismatched = _CONFIG_FIELDS.filter(
        (k) => options[k] !== q._opts[k]
    );
    if (mismatched.length > 0) {
        const diff = mismatched.reduce((acc, k) => {
            acc[k] = { existing: q._opts[k], ignored: options[k] };
            return acc;
        }, {});
        // Prefer the caller's logger so their bunyan context surfaces, but
        // fall back to the queue's own logger if none was supplied.
        (logger || q._logger).warn(
            { loginKey, mismatched: diff },
            'jswidesky-client: queue config mismatch on shared bucket; existing queue config wins'
        );
    }
    return q;
}

function _resetQueueRegistry() {
    _queueRegistry.clear();
}

module.exports = {
    RequestQueue,
    QUEUE_SCHEMA,
    makeLoginKey,
    getRequestQueueForLogin,
    _resetQueueRegistry,
};
