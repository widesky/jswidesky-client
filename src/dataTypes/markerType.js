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
