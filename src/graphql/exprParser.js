/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

const _ = require('lodash');
const moment = require('moment-timezone');
const WHITESPACE = ' ';

class ExprParser{
    // Parse a pair of from and to datetime
    // expression
    // into an ISO8601 datetime string,
    // based on the passed in timezone
    //
    // E.g. now() returns the current date and time
    //
    //
    // Exception will be thrown if the expression
    // is not a valid moment datetime string and
    // if it is an invalid expression.


    // This function takes in a datetime expression
    // which can be either;
    // 1) a valid datetime string which momentJS accepts
    // or
    // 2) a datetime expression such as now(), now - 2h
    //
    // It parses the expression and returns current epoch
    // in ISO8601 date time format.
    static parseDt(
        datetimeExpr,
        timezone) {
        moment.suppressDeprecationWarnings = true;
        let epoch;
        let momentDate = moment(datetimeExpr);

        if (momentDate.isValid()) {
            epoch = momentDate
                      .tz(timezone)
                      .toISOString();
        }
        else {
            epoch = ExprParser.asWideskyDT(
                datetimeExpr,
                timezone);
        }

        return epoch;
    }

    // Returns an epoch time based on a
    // given Widesky datetime expression.
    //
    // Example syntax
    // now - 1d
    //
    // First keyword must be now.
    // Followed by either
    // 1) + or - sign
    // 2) / sign (suffix input)
    //
    // if +/- sign then it must be followed by
    // a number and a 's', d', 'm' or 'M'
    // 's' - second
    // 'd' - day
    // 'm' - min
    // 'h' - hour
    // 'M' - Month
    //
    // If / is defined then it must be followed
    // by a suffix. The allowable value is
    // /s - 00 seconds
    // /d - start of day at 00:00:00
    // /h - start of the hour 00 min 00 second
    // /m - start of minute 0 min
    // /M - start of month Day #1
    static asWideskyDT(expr, timezone) {
        let charArr = expr.split('');
        let position = {
            current: 0
        };

        if (ExprParser.isKeywordNow(charArr, position)) {
            ExprParser.consumeChar(position); // n
            ExprParser.consumeChar(position); // o
            ExprParser.consumeChar(position); // w
            ExprParser.consumeWhitespaces(
                charArr,
                position);

            let momentDt = moment().tz(timezone);

            while (ExprParser.hasChar(charArr, position)) {
                if (ExprParser.isKeywordAdd(
                                    charArr,
                                    position)) {
                    ExprParser.consumeChar(position); // +
                    ExprParser.consumeWhitespaces(
                                    charArr,
                                    position);
                    let numberStr = ExprParser.consumeNumbers(
                        charArr, position);

                    if (!numberStr) {
                        throw new Error(
`Invalid datetime expression ${expr}.
Expecting numbers followed by the + sign.`);
                    }

                    ExprParser.consumeWhitespaces(
                                    charArr,
                                    position);

                    let unit = ExprParser.consumeDatetimeUnit(
                        charArr, position);

                    if (!unit) {
                        throw new Error(
`Invalid datetime expression ${expr}.
Missing unit after '+${numberStr}'`);
                    }

                    let momentUnit = ExprParser.toMomentUnit(unit);
                    momentDt.add(
                        Number.parseInt(numberStr), momentUnit);

                    if (ExprParser.hasChar(charArr, position)) {
                        if (ExprParser.isKeywordSuffixInd(charArr, position)) {
                            ExprParser.consumeChar(position); // the / char
                            ExprParser.consumeWhitespaces(charArr, position);
                            let suffixUnit = ExprParser.consumeDatetimeUnit(
                                charArr,
                                position);

                            if (ExprParser.hasChar(charArr, position)) {
                                throw new Error(
`Invalid datetime expression ${expr}.
Unexpected value found after /${suffixUnit}.`);
                            }

                            let suffixMUnit = ExprParser.toMomentUnit(
                                suffixUnit);

                            momentDt.startOf(suffixMUnit);
                        }
                        else {
                            throw new Error(
`Invalid datetime expression ${expr}.
Expecting a datetime unit after the '/' char.`);
                        }
                    }
                }
                else if (ExprParser.isKeywordSub(
                                    charArr,
                                    position)) {
                    ExprParser.consumeChar(position); // -
                    ExprParser.consumeWhitespaces(
                                    charArr,
                                    position);

                    let numberStr = ExprParser.consumeNumbers(
                        charArr, position);

                    if (!numberStr) {
                        throw new Error(
`Invalid datetime expression ${expr}.
Expecting numbers followed by the - sign.`);
                    }

                    ExprParser.consumeWhitespaces(
                                    charArr,
                                    position);

                    let unit = ExprParser.consumeDatetimeUnit(
                        charArr, position);

                    if (!unit) {
                        throw new Error(
`Invalid datetime expression ${expr}.
Missing unit after '-${numberStr}'`);
                    }

                    let momentUnit = ExprParser.toMomentUnit(unit);
                    momentDt.subtract(
                        Number.parseInt(numberStr), momentUnit);

                    if (ExprParser.hasChar(charArr, position)) {
                        if (ExprParser.isKeywordSuffixInd(charArr, position)) {
                            ExprParser.consumeChar(position); // the / char
                            ExprParser.consumeWhitespaces(charArr, position);
                            let suffixUnit = ExprParser.consumeDatetimeUnit(
                                charArr,
                                position);

                            if (ExprParser.hasChar(charArr, position)) {
                                throw new Error(
`Invalid datetime expression ${expr}.
Unexpected value found after /${suffixUnit}.`);
                            }

                            let suffixMUnit = ExprParser.toMomentUnit(
                                suffixUnit);

                            momentDt.startOf(suffixMUnit);
                        }
                        else {
                            throw new Error(
`Invalid datetime expression ${expr}.
Expecting a datetime unit after the '/' char.`);
                        }
                    }
                }
                else if (ExprParser.isKeywordSuffixInd(
                                    charArr,
                                    position)) {
                    ExprParser.consumeChar(position); // /
                    ExprParser.consumeWhitespaces(
                                    charArr,
                                    position);
                    let suffixUnit = ExprParser.consumeDatetimeUnit(
                                charArr,
                                position);

                    ExprParser.consumeWhitespaces(
                        charArr,
                        position);

                    let suffixMUnit = ExprParser.toMomentUnit(
                        suffixUnit);

                    momentDt.startOf(suffixMUnit);
                }
                else {
                    throw new Error(
`Invalid datetime expression ${expr}.
Expecting '+','-' or '/' sign after now.`);
                }
            }

            return momentDt.toISOString();
        }
        else {
            throw new Error(
`Invalid date time expression(${expr}), it must start with keyword 'now'`);
        }
    }

    static hasChar(charArr, pos) {
        let result = true;

        if (charArr[pos.current] === undefined) {
            // no more left
            result = false;
        }

        return result;
    }

    static toMomentUnit(exprUnit) {
        let mUnit;

        if (exprUnit === 'm') {
            mUnit = 'minutes';
        }
        else if (exprUnit === 's') {
            mUnit = 'seconds'
        }
        else if (exprUnit === 'd') {
            mUnit = 'days'
        }
        else if (exprUnit === 'h') {
            mUnit = 'hours'
        }
        else if (exprUnit === 'M') {
            mUnit = 'months'
        }

        return mUnit;
    }

    static consumeDatetimeUnit(charArr, pos) {
        let unit = null;

        let currChar = charArr[pos.current];

        if (ExprParser.isKeywordSec(currChar)) {
            unit = 's';
        }
        else if (ExprParser.isKeywordMin(currChar)) {
            unit = 'm';
        }
        else if (ExprParser.isKeywordHour(currChar)) {
            unit = 'h';
        }
        else if (ExprParser.isKeywordDay(currChar)) {
            unit = 'd';
        }
        else if (ExprParser.isKeywordMonth(currChar)) {
            unit = 'M';
        }
        else {
            // None of the above
            return unit;
        }

        ExprParser.consumeChar(pos);
        return unit;
    }

    // returns a string of numbers
    static consumeNumbers(charArr, pos) {
        let numberStr = '';
        let consumed = 0;

        for (let index = pos.current;
            index < charArr.length;
            index ++) {
            let currChar = charArr[index];

            if (!isNaN(currChar)) {
                numberStr = numberStr + currChar;
                consumed += 1;
            }
            else {
                // No more numbers
                break;
            }
        }

        pos.current += consumed;
        return numberStr;
    }

    static consumeChar(position) {
        position.current += 1;
    }

    static consumeWhitespaces(charArr, pos) {
        let consumed = 0;

        for (let index = pos.current;
            index < charArr.length;
            index ++) {
            let currChar = charArr[index];

            if (currChar === WHITESPACE) {
                consumed += 1;
            }
            else {
                // No more whitespace
                break;
            }
        }

        pos.current += consumed;
    }

    static isKeywordDay(char) {
        return char === 'd';
    }

    static isKeywordSec(char) {
        return char === 's';
    }

    static isKeywordMin(char) {
        return char === 'm';
    }

    static isKeywordHour(char) {
        return char === 'h';
    }

    static isKeywordMonth(char) {
        return char === 'M';
    }

    static isKeywordSuffixInd(charArr, pos) {
        let isSuffixInd = false;

        if (charArr[pos.current] === '/') {
            isSuffixInd = true;
        }

        return isSuffixInd;
    }

    static isKeywordAdd(charArr, pos) {
        let isAddition = false;

        if (charArr[pos.current] === '+') {
            isAddition = true;
        }

        return isAddition;
    }

    static isKeywordSub(charArr, pos) {
        let isSubtract = false;

        if (charArr[pos.current] === '-') {
            isSubtract = true;
        }

        return isSubtract;
    }

    static isKeywordNow(charArr, pos) {
        let isNow = false;

        if (charArr[pos.current].toLowerCase() === 'n' &&
            charArr[pos.current + 1].toLowerCase() === 'o' &&
            charArr[pos.current + 2].toLowerCase() === 'w') {
            isNow = true;
        }

        return isNow;
    }

    static toMsEpoch(iso8601) {
        return moment(iso8601).valueOf();
    }
}

module.exports = ExprParser;

