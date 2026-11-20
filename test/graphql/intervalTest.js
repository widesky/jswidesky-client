// vim: set tw=78 et sw=4 ts=4 sts=4:
/*
 * BAU-1758: choosing a history groupBy interval from a time range — the
 * client's equivalent of Grafana's $__interval. Ported from the WideSky
 * lighting app (src/data/widesky/interval.test.ts), plus the ladder
 * boundaries, range inputs and the replace hook.
 */
const Interval = require('../../src/graphql/interval');
const Replace = require('../../src/graphql/replace');
const ExprParser = require('../../src/graphql/exprParser');
const jsWideSky = require('../../index');
const chai = require('chai');
const sinon = require('sinon');
const expect = chai.expect;

const {chooseInterval, bucketsIn, TARGET_POINTS} = Interval;

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const END = Date.UTC(2026, 0, 1);

/** A range of `ms` milliseconds ending on 2026-01-01. */
const span = (ms) => ({
    start: new Date(END - ms).toISOString(),
    end: new Date(END).toISOString(),
});
const days = (n) => span(n * DAY);

const LADDER = [
    ['MINUTE', 1, MINUTE],
    ['MINUTE', 5, 5 * MINUTE],
    ['MINUTE', 15, 15 * MINUTE],
    ['MINUTE', 30, 30 * MINUTE],
    ['HOUR', 1, HOUR],
    ['HOUR', 3, 3 * HOUR],
    ['HOUR', 6, 6 * HOUR],
    ['HOUR', 12, 12 * HOUR],
    ['DAY', 1, DAY],
    ['DAY', 2, 2 * DAY],
    ['WEEK', 1, WEEK],
    ['WEEK', 2, 2 * WEEK],
    ['WEEK', 4, 4 * WEEK],
];

describe('graphql.interval (BAU-1758)', () => {
    describe('exports', () => {
        it('is reachable from the graphql namespace', () => {
            expect(jsWideSky.graphql.interval).to.equal(Interval);
            expect(jsWideSky.graphql.chooseInterval).to.equal(chooseInterval);
            expect(jsWideSky.graphql.bucketsIn).to.equal(bucketsIn);
        });

        it('targets 400 points by default', () => {
            expect(TARGET_POINTS).to.equal(400);
        });
    });

    describe('chooseInterval', () => {
        it('returns groupBy fields, ready to spread into a history groupBy', () => {
            expect(chooseInterval(days(365)))
                .to.deep.equal({groupByUnits: 'DAY', groupBySize: 1});
        });

        describe('ladder boundaries', () => {
            /* A range of exactly target × step fits that step; one ms more
             * needs the next one. */
            LADDER.forEach(([units, size, ms], i) => {
                it(`${size} ${units}: fits at exactly ${TARGET_POINTS} buckets`,
                    () => {
                        expect(chooseInterval(span(TARGET_POINTS * ms)))
                            .to.deep.equal({groupByUnits: units, groupBySize: size});
                    });

                const next = LADDER[i + 1];
                if (next) {
                    it(`${size} ${units}: one ms more moves to ${next[1]} ${next[0]}`,
                        () => {
                            expect(chooseInterval(span(TARGET_POINTS * ms + 1)))
                                .to.deep.equal({
                                    groupByUnits: next[0], groupBySize: next[1],
                                });
                        });
                }
            });
        });

        it('coarsens as the range grows, never the other way', () => {
            const sizes = [1, 7, 30, 90, 365, 365 * 3].map((d) => {
                const n = bucketsIn(days(d), chooseInterval(days(d)));
                return n > 0 ? (d * DAY) / n : 0;
            });
            expect(sizes).to.deep.equal([...sizes].sort((a, b) => a - b));
        });

        it('never asks for more buckets than the target', () => {
            [1, 7, 14, 30, 90, 180, 365, 730].forEach((d) => {
                expect(bucketsIn(days(d), chooseInterval(days(d))), `${d} days`)
                    .to.be.at.most(TARGET_POINTS);
            });
        });

        it('asks for at most one bucket over the target when the range is off a boundary', () => {
            /* Buckets align to the epoch, so a range of exactly target × step
             * that starts 1 ms after a boundary straddles one extra bucket. */
            LADDER.forEach(([units, size, ms]) => {
                const start = END + 1;
                const range = {start, end: start + TARGET_POINTS * ms};
                const chosen = chooseInterval(range);
                expect(chosen, `${size} ${units}`)
                    .to.deep.equal({groupByUnits: units, groupBySize: size});
                expect(bucketsIn(range, chosen), `${size} ${units}`)
                    .to.equal(TARGET_POINTS + 1);
            });
        });

        it('only offers round steps, and never a unit past WEEK', () => {
            const allowed = {
                MINUTE: [1, 5, 15, 30], HOUR: [1, 3, 6, 12], DAY: [1, 2], WEEK: [1, 2, 4],
            };
            for (let d = 1; d <= 400; d += 1) {
                const {groupByUnits, groupBySize} = chooseInterval(days(d));
                expect(allowed[groupByUnits], `${d} days -> ${groupByUnits}`)
                    .to.include(groupBySize);
            }
        });

        it('respects a smaller targetPoints', () => {
            const range = days(365);
            expect(bucketsIn(range, chooseInterval(range, {targetPoints: 60})))
                .to.be.at.most(60);
        });

        describe('minimum', () => {
            it('floors the step, for callers that roll buckets up themselves', () => {
                expect(chooseInterval(days(7), {minimum: 'DAY'}))
                    .to.deep.equal({groupByUnits: 'DAY', groupBySize: 1});
            });

            it('has no effect when the range already needs a coarser step', () => {
                expect(chooseInterval(days(365 * 3), {minimum: 'HOUR'}))
                    .to.deep.equal(chooseInterval(days(365 * 3)));
            });

            it('accepts an interval as the floor', () => {
                expect(chooseInterval(days(1),
                    {minimum: {groupByUnits: 'HOUR', groupBySize: 6}}))
                    .to.deep.equal({groupByUnits: 'HOUR', groupBySize: 6});
            });

            it('is also the bucket for an empty range', () => {
                expect(chooseInterval(span(0), {minimum: 'WEEK'}))
                    .to.deep.equal({groupByUnits: 'WEEK', groupBySize: 1});
            });

            it('rejects a unit the server does not have', () => {
                expect(() => chooseInterval(days(30), {minimum: 'MONTH'}))
                    .to.throw(TypeError, /MONTH/);
            });

            it('rejects a floor coarser than the top step, rather than lowering it', () => {
                expect(() => chooseInterval(days(30),
                    {minimum: {groupByUnits: 'WEEK', groupBySize: 8}}))
                    .to.throw(TypeError, /4 WEEK/);
            });

            it('accepts the top step itself as the floor', () => {
                expect(chooseInterval(days(30),
                    {minimum: {groupByUnits: 'WEEK', groupBySize: 4}}))
                    .to.deep.equal({groupByUnits: 'WEEK', groupBySize: 4});
            });
        });

        describe('degenerate ranges still name a bucket', () => {
            /* The server rejects a groupBy without one. */
            it('zero-length', () => {
                expect(chooseInterval(span(0)))
                    .to.deep.equal({groupByUnits: 'MINUTE', groupBySize: 1});
            });

            it('reversed', () => {
                const {start, end} = days(30);
                expect(chooseInterval({start: end, end: start}))
                    .to.deep.equal({groupByUnits: 'MINUTE', groupBySize: 1});
            });

            it('unparseable', () => {
                expect(chooseInterval({start: 'x', end: 'y'}))
                    .to.deep.equal({groupByUnits: 'MINUTE', groupBySize: 1});
            });

            it('missing', () => {
                expect(chooseInterval({}))
                    .to.deep.equal({groupByUnits: 'MINUTE', groupBySize: 1});
                expect(chooseInterval())
                    .to.deep.equal({groupByUnits: 'MINUTE', groupBySize: 1});
            });

            it('null', () => {
                expect(chooseInterval(null))
                    .to.deep.equal({groupByUnits: 'MINUTE', groupBySize: 1});
            });
        });

        it('takes the coarsest step rather than inventing one past the ladder', () => {
            // 20 years (the lighting app's case) lands on the top step.
            expect(chooseInterval(days(365 * 20)))
                .to.deep.equal({groupByUnits: 'WEEK', groupBySize: 4});
            // Past 4 weeks × 400 (~30.7 years) a coarser bucket would be needed;
            // duration has no MONTH, so it stays at 4 weeks with more points.
            const range = days(365 * 40);
            expect(chooseInterval(range))
                .to.deep.equal({groupByUnits: 'WEEK', groupBySize: 4});
            expect(bucketsIn(range, chooseInterval(range)),
                'accepts more points than the target').to.be.above(TARGET_POINTS);
        });

        describe('range inputs', () => {
            it('accepts epoch ms and Date objects', () => {
                expect(chooseInterval({start: END - 365 * DAY, end: END}))
                    .to.deep.equal({groupByUnits: 'DAY', groupBySize: 1});
                expect(chooseInterval({
                    start: new Date(END - 365 * DAY), end: new Date(END),
                })).to.deep.equal({groupByUnits: 'DAY', groupBySize: 1});
            });

            it('accepts the relative expressions exprParser understands', () => {
                expect(chooseInterval({start: 'now-7d', end: 'now'}))
                    .to.deep.equal(chooseInterval(days(7)));
                expect(chooseInterval({start: 'now - 2h', end: 'now'}))
                    .to.deep.equal(chooseInterval(span(2 * HOUR)));
            });

            it('accepts from/to, the names history queries use', () => {
                const {start, end} = days(90);
                expect(chooseInterval({from: start, to: end}))
                    .to.deep.equal(chooseInterval(days(90)));
            });

            it('accepts epoch ms given as a string', () => {
                expect(chooseInterval({
                    start: String(END - 365 * DAY), end: String(END),
                })).to.deep.equal({groupByUnits: 'DAY', groupBySize: 1});
            });

            describe('relative expressions read the clock once', () => {
                let clock;
                beforeEach(() => {
                    /* Every clock read moves time on 5 ms, as a slow machine
                     * would between parsing the start and the end. */
                    let t = END;
                    clock = sinon.stub(Date, 'now').callsFake(() => (t += 5));
                });
                afterEach(() => clock.restore());

                it('chooses as if both ends were read at the same instant', () => {
                    /* 400 days is exactly 400 × 1 day: a second clock read
                     * makes it 5 ms longer and tips it onto 2 days. */
                    expect(chooseInterval({start: 'now-400d', end: 'now'}))
                        .to.deep.equal({groupByUnits: 'DAY', groupBySize: 1});
                });
            });
        });

        describe('exprParser.parseDt with a fixed now', () => {
            it('resolves a relative expression against the given instant', () => {
                const now = Date.UTC(2026, 5, 15, 12);
                expect(ExprParser.toMsEpoch(ExprParser.parseDt('now-1h', 'UTC', now)))
                    .to.equal(now - HOUR);
                expect(ExprParser.toMsEpoch(ExprParser.parseDt('now', 'UTC', now)))
                    .to.equal(now);
            });

            it('leaves absolute times alone', () => {
                const iso = '2026-01-01T00:00:00.000Z';
                expect(ExprParser.parseDt(iso, 'UTC', Date.UTC(2030, 0, 1)))
                    .to.equal(iso);
            });
        });

        it('rejects a non-positive targetPoints', () => {
            [0, -5, NaN, 'many'].forEach((targetPoints) => {
                expect(() => chooseInterval(days(7), {targetPoints}),
                    String(targetPoints)).to.throw(TypeError, /targetPoints/);
            });
        });
    });

    describe('bucketsIn', () => {
        it('counts the buckets an interval cuts a range into', () => {
            expect(bucketsIn(days(1), {groupByUnits: 'HOUR', groupBySize: 1}))
                .to.equal(24);
            expect(bucketsIn(span(90 * MINUTE),
                {groupByUnits: 'HOUR', groupBySize: 1})).to.equal(2);
        });

        it('counts epoch-aligned buckets, as the server cuts them', () => {
            const hourly = {groupByUnits: 'HOUR', groupBySize: 1};
            /* 400 h starting 1 ms past the hour touches 401 hour buckets. */
            const start = END + 1;
            expect(bucketsIn({start, end: start + 400 * HOUR}, hourly))
                .to.equal(401);
            /* Two minutes either side of a boundary: two buckets, not one. */
            expect(bucketsIn({start: END - 2 * MINUTE, end: END + 2 * MINUTE}, hourly))
                .to.equal(2);
            /* A range ending exactly on a boundary does not count the next one. */
            expect(bucketsIn({start: END - HOUR, end: END}, hourly)).to.equal(1);
        });

        it('is 0 for a null range', () => {
            expect(bucketsIn(null, {groupByUnits: 'HOUR', groupBySize: 1}))
                .to.equal(0);
        });

        it('is 0 for empty, reversed or unparseable ranges and odd intervals', () => {
            const hourly = {groupByUnits: 'HOUR', groupBySize: 1};
            expect(bucketsIn(span(0), hourly)).to.equal(0);
            const {start, end} = days(1);
            expect(bucketsIn({start: end, end: start}, hourly)).to.equal(0);
            expect(bucketsIn({start: 'x', end: 'y'}, hourly)).to.equal(0);
            expect(bucketsIn(days(1), {groupByUnits: 'MONTH', groupBySize: 1}))
                .to.equal(0);
            expect(bucketsIn(days(1), {groupByUnits: 'HOUR', groupBySize: 0}))
                .to.equal(0);
        });
    });

    describe('replace.intervalVars', () => {
        const TEMPLATE = 'aggregate(function: MEAN, groupBy: {groupByUnits: ' +
            '$__intervalDuration, groupBySize: $__intervalNum, fill: NONE})';

        it('fills the Grafana datasource placeholders, so one template serves both', () => {
            expect(Replace.intervalVars(TEMPLATE,
                {groupByUnits: 'HOUR', groupBySize: 6}))
                .to.equal('aggregate(function: MEAN, groupBy: {groupByUnits: ' +
                    'HOUR, groupBySize: 6, fill: NONE})');
        });

        it('also fills $__intervalUnits / $__intervalSize', () => {
            expect(Replace.intervalVars(
                'groupBy: {groupByUnits: $__intervalUnits, groupBySize: $__intervalSize}',
                {groupByUnits: 'DAY', groupBySize: 1}))
                .to.equal('groupBy: {groupByUnits: DAY, groupBySize: 1}');
        });

        it('fills every occurrence and leaves other variables alone', () => {
            const q = '$__intervalNum $__intervalNum $__interval $from';
            expect(Replace.intervalVars(q, {groupByUnits: 'WEEK', groupBySize: 2}))
                .to.equal('2 2 $__interval $from');
        });

        it('chooses the interval itself when given a range', () => {
            expect(Replace.intervalVars(TEMPLATE, days(365)))
                .to.equal('aggregate(function: MEAN, groupBy: {groupByUnits: ' +
                    'DAY, groupBySize: 1, fill: NONE})');
        });

        it('accepts the {units, size} interval shape callers migrate from', () => {
            expect(Replace.intervalVars(TEMPLATE, {units: 'DAY', size: 1}))
                .to.equal('aggregate(function: MEAN, groupBy: {groupByUnits: ' +
                    'DAY, groupBySize: 1, fill: NONE})');
        });

        it('falls back to the finest step for a null argument', () => {
            expect(Replace.intervalVars(TEMPLATE, null))
                .to.equal('aggregate(function: MEAN, groupBy: {groupByUnits: ' +
                    'MINUTE, groupBySize: 1, fill: NONE})');
        });

        it('matches placeholders case-insensitively', () => {
            expect(Replace.intervalVars('$__INTERVALDURATION $__IntervalNum',
                {groupByUnits: 'HOUR', groupBySize: 3})).to.equal('HOUR 3');
        });

        it('leaves longer names that only start with a placeholder alone', () => {
            const q = '$__intervalNumber $__intervalDurationX $__intervalSizes $__intervalMs';
            expect(Replace.intervalVars(q, {groupByUnits: 'HOUR', groupBySize: 3}))
                .to.equal(q);
        });
    });
});
