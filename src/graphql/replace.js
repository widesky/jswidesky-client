/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
"use strict";

const _ = require("lodash");
const FIND_HISTORY_INPUT = /history(.*){/g;
const FIND_FILTER_INPUT = /filter:\s?"(.*)"/g;

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
                        "$from",
                        from);
                }

                if (to) {
                    histInput = _.replace(
                        histInput,
                        "$to",
                        to);
                }

                return histInput;
            });
    }

}

module.exports = Replace;
