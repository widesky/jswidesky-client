/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

const VER_3 = '3.0';

/**
 * Remove data type, a singleton that indicates a tag is to be removed.
 */
class RemoveType {
    HS_JSON_V2_STR = 'x:';
    HS_JSON_V3_STR = '-:';
    HS_ZINC_STR = 'R';

    toHSJSON(version) {
        if (version === VER_3)
            return this.HS_JSON_V3_STR;
        else
            return this.HS_JSON_V2_STR;
    };

    toHSZINC() {
        return this.HS_ZINC_STR;
    };
}

module.exports = RemoveType;
