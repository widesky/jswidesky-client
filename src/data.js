/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
"use strict";

const jsesc = require('jsesc');
const MarkerType = require("./dataTypes/markerType");
const NAType = require("./dataTypes/naType");
const RemoveType = require("./dataTypes/removeType");
const Ref = require("./dataTypes/ref");
const HSNumber = require("./dataTypes/hsNumber");

const VER_2 = '2.0';
const VER_3 = '3.0';
const MARKER = new MarkerType();
const REMOVE = new RemoveType();
const NA = new NAType();

/**
 * Parsing of strings from JSON or ZINC.
 */
String.fromHS = function(str) {
    if (str.startsWith('s:') || str.startsWith('u:')) {
        return str.substring(2);    /* JSON */
    } else if (str.startsWith('"') && str.endsWith('"')) {
        return JSON.parse(str);     /* ZINC; close enough to normal JSON */
    } else {
        return str;
    }
};

/**
 * Augment the standard string type to support emitting Project Haystack JSON.
 */
String.prototype.toHSJSON = function() {
    return 's:' + this;
};

/**
 * Augment the standard string type to support emitting Project Haystack ZINC.
 */
String.prototype.toHSZINC = function() {
    return jsesc(this, {quotes: 'double', wrap: true});
};

/**
 * Parsing of dates from JSON or ZINC.
 */
Date.fromHS = function(str) {
    var space = str.indexOf(' ');
    if (space >= 0) {
        str = str.substring(0, space);
    }

    if (str.startsWith('t:')) {
        str = str.substring(2);    /* JSON */
    }
    
    return (new Date (Date.parse(str)));
};

/**
 * Augment the standard date type to support emitting Project Haystack JSON.
 */
Date.prototype.toHSJSON = function() {
    return 't:' + this.toJSON() + ' UTC';
};

/**
 * Augment the standard date type to support emitting Project Haystack ZINC.
 */
Date.prototype.toHSZINC = function() {
    return this.toJSON() + ' UTC';
};

/**
 * Parsing of numbers from JSON or ZINC
 */
Number.fromHS = function(str) {
    return new HSNumber(str);
};

/**
 * Augment the standard number type to support conversion to a HSNumber.
 */
Number.prototype.toHSNumber = function(unit) {
    return new HSNumber(this, unit);
};

/**
 * Augment the standard number type to support emitting Project Haystack JSON.
 */
Number.prototype.toHSJSON = function() {
    return this.toHSNumber().toHSJSON();
};

/**
 * Augment the standard number type to support emitting Project Haystack ZINC.
 */
Number.prototype.toHSZINC = function() {
    return this.toHSNumber().toHSZINC();
};

/**
 * Parse a JSON string in Haystack ZINC/JSON encoding
 */
function _parseString(str) {
    if (str === 'm:')
        return MARKER;
    if (str === 'z:')
        return NA;
    if ((str === 'x:') || (str === '-:'))
        return REMOVE;

    const prefix = str.substring(0, 2);

    if (prefix === 'n:')
        return Number.fromHS(str);
    if (prefix === 'r:')
        return new Ref(str);
    if (prefix === 's:')
        return String.fromHS(str);
    if (prefix === 't:')
        return Date.fromHS(str);

    /* Must be a bare string */
    return str;
}

/**
 * Parse a list
 */
function _parseList(list) {
    return list.map((element) => {
        return parse(element);
    });
}

/**
 * Dump a list
 */
function _dumpList(list, version) {
    return list.map((element) => {
        return dump(element, version);
    });
}

/**
 * Parse a grid
 */
function _parseGrid(grid) {
    const parsed = {};

    parsed.meta = _parseDict(grid.meta, 'ver');
    parsed.cols = grid.cols.map((col) => {
        return _parseDict(col, 'name');
    });
    parsed.rows = grid.rows.map((row) => {
        return _parseDict(row);
    });

    return parsed;
}

/**
 * Dump a grid
 */
function _dumpGrid(grid, version) {
    const dumped = {};

    dumped.meta = _dumpDict(grid.meta, 'ver', grid.meta.ver);
    dumped.cols = grid.cols.map((col) => {
        return _dumpDict(col, 'name', grid.meta.ver);
    });
    dumped.rows = grid.rows.map((row) => {
        return _dumpDict(row, undefined, grid.meta.ver);
    });

    return dumped;
}

/**
 * Parse a dict, optionally passing through a property value
 */
function _parseDict(dict, passThrough) {
    var parsed = {};

    if (passThrough) {
        dict = Object.assign({}, dict);
        parsed[passThrough] = dict[passThrough];
        delete dict[passThrough];
    }

    Object.keys(dict).forEach((tag) => {
        parsed[tag] = parse(dict[tag]);
    });

    return parsed;
}

/**
 * Dump a dict, optionally passing through a property value
 */
function _dumpDict(dict, passThrough, version) {
    const dumped = {};

    if (passThrough) {
        dict = Object.assign({}, dict);
        dumped[passThrough] = dict[passThrough];
        delete dict[passThrough];
    }

    Object.keys(dict).forEach((tag) => {
        dumped[tag] = dump(dict[tag], version);
    });

    return dumped;
}

/**
 * Parse an arbitrary value and return the relevant JavaScript
 * type.
 */
function parse(value) {
    if ((value === null) || (typeof(value) === 'boolean')) {
        /* Raw types */
        return value;
    } else if (value === undefined) {
        /* Catch and handle null type */
        return null;
    } else if (typeof(value) === 'string') {
        return _parseString(value);
    } else
    /* Not likely to be anything else */
    /* istanbul ignore else */
    if (typeof(value) === 'object') {
        if (Array.isArray(value)) {
            /* Parse the elements */
            return _parseList(value);
        } else if (value.hasOwnProperty('meta')
                    && value.hasOwnProperty('cols')
                    && value.hasOwnProperty('rows')) {
            /* This is a grid */
            return _parseGrid(value);
        } else {
            /* This is a dict */
            return _parseDict(value);
        }
    }
}

/**
 * Dump the given input in JSON format.
 */
function dump(value, version) {
    if ((value === null) || (typeof(value) === 'boolean')) {
        /* Raw types */
        return value;
    } else if (value === undefined) {
        /* Catch and handle null type */
        return null;
    } else if (typeof(value.toHSJSON) === 'function') {
        return value.toHSJSON(version);
    } else
    /* Unlikely that we'll strike anything else */
    /* istanbul ignore else */
    if (typeof(value) === 'object') {
        if (Array.isArray(value)) {
            /* Dump the elements */
            return _dumpList(value, version);
        } else if (value.hasOwnProperty('meta')
                    && value.hasOwnProperty('cols')
                    && value.hasOwnProperty('rows')) {
            /* This is a grid */
            return _dumpGrid(value);
        } else {
            /* This is a dict */
            return _dumpDict(value, undefined, version);
        }
    }
}

/* Exported symbols */
module.exports = {
    VER_2: VER_2,
    VER_3: VER_3,
    MARKER: MARKER,
    NA: NA,
    REMOVE: REMOVE,
    Ref: Ref,
    HSNumber: HSNumber,
    String: String,
    Number: Number,
    Date: Date,
    parse: parse,
    dump: dump
};
