/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Outbound request queue for jswidesky-client. Opt-in via
 * options.client.queue. Hand-rolled FIFO with concurrency cap, minimum
 * inter-dispatch delay, and a hard maxQueueDepth refuse.
 *
 * One queue per WideSkyClient instance. Coordination across multiple
 * instances is out of scope: a deployment that wants a shared throttle
 * should reuse a single client instance.
 */
'use strict';

const yup = require('yup');
const { QueueFullError } = require('../errors');

class RequestQueue {
    constructor(opts, logger) {
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
    highWaterPct:       yup.number().min(0).max(1).default(0.8),
    highWaterLogEveryN: yup.number().integer().min(1).default(50),
}).default(undefined);

module.exports = {
    RequestQueue,
    QUEUE_SCHEMA,
};
