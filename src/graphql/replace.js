/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

const _ = require('lodash');
const {chooseInterval} = require('./interval');
const FIND_HISTORY_INPUT = /history(.*){/g;
const FIND_FILTER_INPUT = /filter:\s?"(.*)"/g;
/* The WideSky Grafana datasource's names come first so one template serves
 * both Grafana and apps; $__intervalUnits / $__intervalSize are aliases. Like
 * the datasource, matched case-insensitively. The lookahead stops a longer
 * variable name matching. */
const INTERVAL_UNITS_VAR = /\$__interval(?:Duration|Units)(?![A-Za-z0-9_])/gi;
const INTERVAL_SIZE_VAR = /\$__interval(?:Num|Size)(?![A-Za-z0-9_])/gi;

/**
 * An utility for replacing placeholder
 * variables defined in a widesky query.
 * e.g. $from and $to variables of the history
 * node.
 **/
class Replace {

    static outerBraces(query) {
        let trimmedQ = _.trimStart(query);

        if (!_.startsWith(trimmedQ, '{')) {
            query = `{ ${query} }`;
        }

        return query;
    }

    static filterVar(
        query,
        varname,
        varval) {
        varname = _.trimStart(varname);
        if (!_.startsWith(varname, '$')) {
            varname = `\$${varname}`;
        }

        // Forward slash the $ character for regexpr,
        varname = "\\" + varname;
        const pattern = new RegExp(varname, 'g');

        return query.replace(pattern, varval);
    }

    /**
     * Substitute time variables
     * $from and $to
     **/
    static timeVars(
        query,
        from,
        to) {
        return _.replace(query,
            FIND_HISTORY_INPUT,
            (histInput) => {
                if (from) {
                    histInput = _.replace(
                        histInput,
                        '$from',
                        from);
                }

                if (to) {
                    histInput = _.replace(
                        histInput,
                        '$to',
                        to);
                }

                return histInput;
            });
    }

    /**
     * Substitute the history groupBy interval variables (BAU-1758):
     * `$__intervalDuration` / `$__intervalUnits` become the units and
     * `$__intervalNum` / `$__intervalSize` the size, e.g.
     * `groupBy: {groupByUnits: $__intervalDuration, groupBySize: $__intervalNum}`.
     * Other variables, including a bare `$__interval`, are left alone.
     *
     * @param {string} query the query template.
     * @param {import('./interval').GroupByInterval | import('./interval').TimeRange} intervalOrRange
     *     an interval from `chooseInterval`, or a time range to choose one for
     *     (with the default target).
     * @returns {string}
     **/
    static intervalVars(query, intervalOrRange) {
        const interval = intervalOrRange && intervalOrRange.groupByUnits !== undefined
            ? intervalOrRange
            : chooseInterval(intervalOrRange);

        return query
            .replace(INTERVAL_UNITS_VAR, String(interval.groupByUnits))
            .replace(INTERVAL_SIZE_VAR, String(interval.groupBySize));
    }

}

module.exports = Replace;
