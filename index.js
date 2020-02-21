/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 */
"use strict";

var client = require('./src/client'),
    data = require('./src/data');

/* Exported symbols */
module.exports = {
    /* Client code */
    WideSkyClient: client,
    /* Data types */
    Ref: data.Ref,
    String: data.String,    // polyfilled
    Number: data.Number,    // polyfilled
    Date: data.Date,        // polyfilled
    HSNumber: data.HSNumber
};
