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
