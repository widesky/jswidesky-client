/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 */
"use strict";

var client = require('./src/client'),
    data = require('./src/data'),
    replace = require('./src/graphql/replace'),
    exprParser = require('./src/graphql/exprParser');

/* Exported symbols */
const jsWidesky = {
    /* Client code */
    WideSkyClient: client,
    /* Constants */
    VER_2: data.VER_2,
    VER_3: data.VER_3,
    /* Data types */
    MARKER: data.MARKER,
    NA: data.NA,
    REMOVE: data.REMOVE,
    Ref: data.Ref,
    String: data.String,    // polyfilled
    Number: data.Number,    // polyfilled
    Date: data.Date,        // polyfilled
    HSNumber: data.HSNumber,
    /* Helper routines */
    parse: data.parse,
    dump: data.dump,
    graphql: {
        replace,
        exprParser
    }
};

if (typeof window === 'undefined') {
    // NodeJs
    module.exports = jsWidesky;
}
else {
    // Browser
    window.jsWidesky = jsWidesky;
}
