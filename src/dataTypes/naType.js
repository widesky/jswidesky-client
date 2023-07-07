/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
'use strict';

/**
 * NA data type, a singleton that indicates a tag's value is not available.
 */
class NAType {
    HS_JSON_STR = 'z:';
    HS_ZINC_STR = 'NA';

    toHSJSON() {
        return this.HS_JSON_STR;
    };

    toHSZINC() {
        return this.HS_ZINC_STR;
    };
}

module.exports = NAType;
