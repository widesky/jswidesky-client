/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */

/**
 * Choosing how coarsely to group a history read: the client's equivalent of
 * Grafana's `$__interval` (BAU-1758).
 *
 * A GraphQL `history` read with no `groupBy` returns every stored sample.
 * Over a long range that is megabytes of JSON for a chart that can draw a few
 * hundred marks. `History.aggregate`, `select`, `delta`, `cumulativeSum` and
 * `movingAverage` take a `groupBy` that makes the server do the folding;
 * `chooseInterval` sizes it from "range ÷ how many points will fit", the
 * figure Grafana takes from the panel width.
 *
 * ⚠️ The `duration` enum stops at WEEK (MILLISECOND … WEEK): there is no
 * MONTH or YEAR, so this never emits one. A monthly view rolls up from days
 * in the caller (pass `minimum: 'DAY'`).
 *
 * ⚠️ There is deliberately no "one bucket for the whole range" option: buckets
 * align to the epoch, not the range start, so a bucket as long as the range
 * splits it in two. For a range total, drop `groupBy` on the outer aggregate.
 *
 * Moved from the WideSky lighting app (src/data/widesky/interval.ts) so other
 * apps get it for free; the step choice is unchanged.
 **/
'use strict';

const ExprParser = require('./exprParser');

/**
 * The `duration` units this helper emits.
 * @typedef {'MINUTE' | 'HOUR' | 'DAY' | 'WEEK'} GroupByUnits
 */

/**
 * A history `groupBy` bucket, named as the GraphQL `groupBy` input names its
 * fields, so it can be spread straight into a query:
 * `groupBy: {groupByUnits: DAY, groupBySize: 1, fill: NONE}`.
 * @typedef {Object} GroupByInterval
 * @property {GroupByUnits} groupByUnits
 * @property {number} groupBySize
 */

/**
 * A point in time: an ISO 8601 string, epoch milliseconds (as a number or a
 * string of digits), a `Date`, or a relative expression `exprParser`
 * understands (`now`, `now-7d`, `now - 2h`). An ISO string without a zone
 * offset is read in the host's local time zone, so pass a `Z` or an offset
 * when the result must not depend on where the code runs.
 * @typedef {string | number | Date} TimeInput
 */

/**
 * A time range, as `{start, end}` or as the `{from, to}` that history query
 * templates use.
 * @typedef {Object} TimeRange
 * @property {TimeInput} [start]
 * @property {TimeInput} [end]
 * @property {TimeInput} [from]
 * @property {TimeInput} [to]
 */

/**
 * Options for {@link chooseInterval}.
 * @typedef {Object} ChooseIntervalOptions
 * @property {number} [targetPoints=400] the most buckets wanted.
 * @property {GroupByUnits | GroupByInterval} [minimum] the finest bucket to
 *     return, for callers that roll buckets up further themselves.
 */

/**
 * How many buckets a chart is worth asking for. 400 keeps a year at one point
 * per day; a ~700 px chart cannot show finer than that anyway.
 * @type {number}
 */
const TARGET_POINTS = 400;

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** @type {Record<GroupByUnits, number>} */
const UNIT_MS = {MINUTE, HOUR, DAY, WEEK};

/**
 * The ladder, finest first. Round steps only, so axis labels land on times
 * people recognise and repeat reads over slightly different ranges line up;
 * the same ladder Grafana's interval calculator walks.
 * @type {ReadonlyArray<Readonly<GroupByInterval & {ms: number}>>}
 */
const LADDER = Object.freeze([
    {groupByUnits: 'MINUTE', groupBySize: 1},
    {groupByUnits: 'MINUTE', groupBySize: 5},
    {groupByUnits: 'MINUTE', groupBySize: 15},
    {groupByUnits: 'MINUTE', groupBySize: 30},
    {groupByUnits: 'HOUR', groupBySize: 1},
    {groupByUnits: 'HOUR', groupBySize: 3},
    {groupByUnits: 'HOUR', groupBySize: 6},
    {groupByUnits: 'HOUR', groupBySize: 12},
    {groupByUnits: 'DAY', groupBySize: 1},
    {groupByUnits: 'DAY', groupBySize: 2},
    {groupByUnits: 'WEEK', groupBySize: 1},
    {groupByUnits: 'WEEK', groupBySize: 2},
    {groupByUnits: 'WEEK', groupBySize: 4},
].map((step) => Object.freeze({
    ...step, ms: UNIT_MS[step.groupByUnits] * step.groupBySize,
})));

/** A string that is only digits (optionally signed): epoch milliseconds. */
const EPOCH_MS_STRING = /^\s*-?\d+\s*$/;

/**
 * Milliseconds since the epoch for a time input; NaN when it is missing or
 * cannot be parsed.
 * @param {TimeInput | undefined | null} value
 * @param {number} now the instant a relative expression is resolved against.
 * @returns {number}
 */
function toEpochMs(value, now) {
    if (value === undefined || value === null || value === '') {
        return NaN;
    }
    if (typeof value === 'number') {
        return value;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    const text = String(value);
    if (EPOCH_MS_STRING.test(text)) {
        return Number(text);
    }
    try {
        /* parseDt takes ISO strings and `now-7d` style expressions. Its zone
         * argument only affects how the result is rendered; an ISO string
         * with no offset is still read in the host's local zone. */
        return ExprParser.toMsEpoch(ExprParser.parseDt(text, 'UTC', now));
    }
    catch (err) {
        return NaN;
    }
}

/**
 * Both ends of a range in epoch ms (NaN for an unusable end). Relative
 * expressions on both ends are resolved against one clock read, so
 * `{start: 'now-7d', end: 'now'}` is exactly 7 days however long parsing takes.
 * @param {TimeRange | null} [range]
 * @returns {{start: number, end: number}}
 */
function rangeMs(range) {
    const r = range || {};
    const now = Date.now();
    return {
        start: toEpochMs(r.start !== undefined ? r.start : r.from, now),
        end: toEpochMs(r.end !== undefined ? r.end : r.to, now),
    };
}

/**
 * The span of a range in ms, or NaN when either end is unusable.
 * @param {TimeRange | null} [range]
 * @returns {number}
 */
function spanMs(range) {
    const {start, end} = rangeMs(range);
    return Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;
}

/**
 * The length in ms of an interval, accepting the `{units, size}` shape too
 * for callers migrating from a local copy. 0 for anything unusable.
 * @param {GroupByInterval | {units: string, size: number}} interval
 * @returns {number}
 */
function intervalMs(interval) {
    if (!interval) {
        return 0;
    }
    const units = interval.groupByUnits !== undefined
        ? interval.groupByUnits : interval.units;
    const size = Number(interval.groupBySize !== undefined
        ? interval.groupBySize : interval.size);
    const unitMs = UNIT_MS[units];
    return unitMs && Number.isFinite(size) && size > 0 ? unitMs * size : 0;
}

/**
 * The floor, in ms, for a `minimum` option.
 * @param {GroupByUnits | GroupByInterval | undefined} minimum
 * @returns {number}
 */
function floorMs(minimum) {
    if (minimum === undefined || minimum === null) {
        return 0;
    }
    const ms = typeof minimum === 'string'
        ? UNIT_MS[minimum] || 0
        : intervalMs(minimum);
    if (!ms) {
        throw new TypeError(
            `minimum must be one of ${Object.keys(UNIT_MS).join(', ')} (the`
            + ' history duration enum stops at WEEK) or a {groupByUnits,'
            + ` groupBySize} interval, got ${JSON.stringify(minimum)}`);
    }
    const top = LADDER[LADDER.length - 1];
    if (ms > top.ms) {
        throw new TypeError(
            `minimum must be no coarser than the top step, ${top.groupBySize}`
            + ` ${top.groupByUnits}; got ${JSON.stringify(minimum)}. Roll up`
            + ' coarser buckets in the caller.');
    }
    return ms;
}

/**
 * The finest round bucket that keeps a range within `targetPoints` buckets.
 *
 * - Buckets align to the epoch, not the range start. A range that does not
 *   start on a bucket boundary straddles one extra bucket, so the server can
 *   return up to `targetPoints + 1` buckets (see {@link bucketsIn}). The step
 *   choice is kept identical to the lighting app's, which this replaces.
 * - A bucket finer than the data costs nothing with `fill: NONE` (empty
 *   buckets are not returned), so the ladder never needs the poll rate.
 * - A zero-length, reversed or unparseable range still gets a bucket (the
 *   finest allowed): the server rejects a `groupBy` without one.
 * - Past 4 weeks × `targetPoints`, it keeps the coarsest step (4 weeks) and
 *   accepts more buckets rather than inventing a step the server lacks.
 *
 * @param {TimeRange} [range]
 * @param {ChooseIntervalOptions} [options]
 * @returns {GroupByInterval}
 */
function chooseInterval(range, {targetPoints = TARGET_POINTS, minimum} = {}) {
    if (typeof targetPoints !== 'number' || !Number.isFinite(targetPoints)
        || targetPoints <= 0) {
        throw new TypeError(
            `targetPoints must be a positive number, got ${String(targetPoints)}`);
    }
    const floor = floorMs(minimum);
    /* floorMs rejects a floor coarser than the top step, so this is never empty. */
    const steps = LADDER.filter((step) => step.ms >= floor);

    const span = spanMs(range);
    let chosen;
    if (!(span > 0)) {
        chosen = steps[0];
    }
    else {
        chosen = steps.find((step) => span / step.ms <= targetPoints)
            || steps[steps.length - 1];
    }
    return {groupByUnits: chosen.groupByUnits, groupBySize: chosen.groupBySize};
}

/**
 * How many buckets the server cuts a range into for an interval, for logging
 * and tests. Buckets align to the epoch, so this counts every bucket the range
 * touches: a range off a bucket boundary can touch one more than
 * `span / interval`. 0 for an empty, reversed or unparseable range, or an
 * unusable interval.
 * @param {TimeRange | null} range
 * @param {GroupByInterval | {units: string, size: number}} interval
 * @returns {number}
 */
function bucketsIn(range, interval) {
    const {start, end} = rangeMs(range);
    const ms = intervalMs(interval);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)
        || ms <= 0) {
        return 0;
    }
    /* The bucket holding the first instant, through the one holding the last
     * (the range end is exclusive). */
    return Math.floor((end - 1) / ms) - Math.floor(start / ms) + 1;
}

module.exports = {
    TARGET_POINTS,
    LADDER,
    chooseInterval,
    bucketsIn,
};
