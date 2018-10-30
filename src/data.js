/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * WideSky API data type handler.
 * (C) 2017 VRT Systems
 */
"use strict";

var jsesc = require('jsesc');

/**
 * Project Haystack Ref data type.  A reference to another entity.
 */
var Ref = function(id, dis) {
    if ((typeof id) === 'object') {
        /* Clone constructor */
        if (dis !== undefined)
            throw new Error('clone constructor takes a Ref only');

        if ((typeof id.id) !== 'string')
            throw new Error(
                'clonee object \'id\' property must be a string'
            );

        if (id.dis && ((typeof id.dis) !== 'string'))
            throw new Error(
                'clonee object \'dis\' property must be null or a string'
            );

        this.id = id.id;
        this.dis = id.dis;
    } else {
        /* id must be a string */
        if ((typeof id) !== 'string')
            throw new Error('id is not a string');

        var space = id.indexOf(' ');
        if (space >= 0) {
            if (dis !== undefined) {
                throw new Error('id may not contain spaces');
            }

            /* Split on the space */
            dis = id.substring(space+1);
            id = id.substring(0, space);
        }

        if (id.startsWith('r:')) {
            /* JSON Ref */
            this.id = id.substring(2);
        } else if (id.startsWith('@')) {
            /* ZINC Ref */
            this.id = id.substring(1);
            if (dis) {
                if (!(dis.startsWith('"') && dis.endsWith('"')))
                    throw new Error('dis must be a valid ZINC string');
                dis = JSON.parse(dis);
            }
        } else {
            /* Raw ID */
            this.id = id;
        }

        /* Descriptive text */
        this.dis = dis || null;
    }
};

Ref.prototype.toHSJSON = function() {
    var res = 'r:' + this.id;
    if (this.dis) {
        res += ' ' + this.dis;
    }
    return res;
};

Ref.prototype.toHSZINC = function() {
    var res = '@' + this.id;
    if (this.dis) {
        res += ' ' + this.dis.toHSZINC();
    }
    return res;
};

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
 * Project Haystack ZINC number regular expression.  Not perfect, but it'll do
 * for now.
 */
const HS_ZINC_NUM = /^(-?\d+|-?\d+\.\d+|-?\d+[eE]\d+|-?\d+\.\d+[eE]\d+|-?\d+[eE]\d+)([^\.]*)$/;

/**
 * Project Haystack Number data type
 */
var HSNumber = function(str, unit) {
    if ((typeof str) === 'object') {
        /* Copy constructor */
        if ((typeof str.value) !== 'number')
            throw new Error(
                'clonee \'value\' property must be a number');

        if (str.unit && ((typeof str.unit) !== 'string'))
            throw new Error(
                'clonee \'unit\' property must be a string or undefined'
            );

        this.value = str.value;
        this.unit = str.unit;
    } else if (typeof str === 'number') {
        /* Cast constructor */
        this.value = str;
        this.unit = unit || undefined;
    } else if (str.startsWith('n:')) {
        var space = str.indexOf(' ');
        var strnum = null;
        var unit = undefined;

        if (space >= 0) {
            strnum = str.substring(2,space);
            unit = str.substring(space+1);
        } else {
            strnum = str.substring(2);
        }

        if (strnum.indexOf('.') >= 0) {
            this.value = Number.parseFloat(strnum);
            this.unit = unit;
        } else {
            this.value = Number.parseInt(strnum);
            this.unit = unit;
        }
    } else {
        var m = str.match(HS_ZINC_NUM);
        if (m[1].indexOf('.') >= 0) {
            this.value = Number.parseFloat(m[1]);
        } else {
            this.value = Number.parseInt(m[1]);
        }
        this.unit = (m[2] || undefined);
    }
};

/**
 * Emit Project Haystack JSON.
 */
HSNumber.prototype.toHSJSON = function() {
    var res = 'n:' + this.value.toString();
    if (this.unit !== undefined) {
        res += ' ' + this.unit;
    }
    return res;
};

/**
 * Emit Project Haystack ZINC.
 */
HSNumber.prototype.toHSZINC = function() {
    var res = this.value.toString();
    if (this.unit !== undefined) {
        res += this.unit;
    }
    return res;
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

/* Exported symbols */
module.exports = {
    Ref: Ref,
    HSNumber: HSNumber,
    String: String,
    Number: Number,
    Date: Date
};
