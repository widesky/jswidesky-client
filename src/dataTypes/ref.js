/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
"use strict";

/**
 * Project Haystack Ref data type.  A reference to another entity.
 */
class Ref {
    HS_ZINC_PREFIX = '@';
    HS_JSON_PREFIX = 'r:';

    constructor(id, dis) {
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

            if (id.startsWith(this.HS_JSON_PREFIX)) {
                /* JSON Ref */
                this.id = id.substring(2);
            } else if (id.startsWith(this.HS_ZINC_PREFIX)) {
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
    }

    toHSJSON() {
        let res = this.HS_JSON_PREFIX + this.id;
        if (this.dis) {
            res += ' ' + this.dis;
        }

        return res;
    };

    toHSZINC() {
        let res = this.HS_ZINC_PREFIX + this.id;
        if (this.dis) {
            res += ' ' + this.dis.toHSZINC();
        }

        return res;
    };
}

module.exports = Ref;
