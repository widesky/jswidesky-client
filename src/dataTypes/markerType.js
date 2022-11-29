/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2022 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
"use strict";

/**
 * Marker data type, a singleton that indicates a tag exists.
 */
class MarkerType {
    HS_JSON_STR = "m:";
    HS_ZINC_STR = "M";

    toHSJSON() {
        return this.HS_JSON_STR;
    };

    toHSZINC() {
        return this.HS_ZINC_STR
    };
}

module.exports = MarkerType;
