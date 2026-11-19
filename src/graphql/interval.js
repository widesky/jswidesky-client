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
 * A point in time: an ISO 8601 string, epoch milliseconds, a `Date`, or a
 * relative expression `exprParser` understands (`now`, `now-7d`, `now - 2h`).
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

/**
 * Milliseconds since the epoch for a time input; NaN when it is missing or
 * cannot be parsed.
 * @param {TimeInput | undefined | null} value
 * @returns {number}
 */
function toEpochMs(value) {
    if (value === undefined || value === null || value === '') {
        return NaN;
    }
    if (typeof value === 'number') {
        return value;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    try {
        /* parseDt takes ISO strings and `now-7d` style expressions; the zone
         * only affects the rendering of its result, not the instant. */
        return ExprParser.toMsEpoch(ExprParser.parseDt(String(value), 'UTC'));
    }
    catch (err) {
        return NaN;
    }
}

/**
 * The span of a range in ms, or NaN when either end is unusable.
 * @param {TimeRange} [range]
 * @returns {number}
 */
function spanMs(range = {}) {
    const start = toEpochMs(range.start !== undefined ? range.start : range.from);
    const end = toEpochMs(range.end !== undefined ? range.end : range.to);
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
    return ms;
}

/**
 * The finest round bucket that keeps a range within `targetPoints` buckets.
 *
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
    const usable = LADDER.filter((step) => step.ms >= floor);
    /* A floor coarser than the top step leaves only the top step. */
    const steps = usable.length > 0 ? usable : [LADDER[LADDER.length - 1]];

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
 * How many buckets an interval cuts a range into, for logging and tests.
 * 0 for an empty, reversed or unparseable range, or an unusable interval.
 * @param {TimeRange} range
 * @param {GroupByInterval} interval
 * @returns {number}
 */
function bucketsIn(range, interval) {
    const span = spanMs(range);
    const ms = intervalMs(interval);
    if (!(span > 0) || ms <= 0) {
        return 0;
    }
    return Math.ceil(span / ms);
}

module.exports = {
    TARGET_POINTS,
    LADDER,
    chooseInterval,
    bucketsIn,
};
