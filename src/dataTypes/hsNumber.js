/**
 * Project Haystack ZINC number regular expression.  Not perfect, but it'll do
 * for now.
 */
const HS_ZINC_NUM = /^(-?\d+|-?\d+\.\d+|-?\d+[eE]\d+|-?\d+\.\d+[eE]\d+|-?\d+[eE]\d+)([^\.]*)$/;

/**
 * Project Haystack Number data type
 */
class HSNumber {
    constructor(str, unit) {
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
            const space = str.indexOf(' ');
            let strNum = null;
            let unit = undefined;

            if (space >= 0) {
                strNum = str.substring(2,space);
                unit = str.substring(space+1);
            } else {
                strNum = str.substring(2);
            }

            if (strNum.indexOf('.') >= 0) {
                this.value = Number.parseFloat(strNum);
                this.unit = unit;
            } else {
                this.value = Number.parseInt(strNum);
                this.unit = unit;
            }
        } else {
            let m = str.match(HS_ZINC_NUM);
            if (m[1].indexOf('.') >= 0) {
                this.value = Number.parseFloat(m[1]);
            } else {
                this.value = Number.parseInt(m[1]);
            }
            this.unit = (m[2] || undefined);
        }
    }

    /**
     * Emit Project Haystack JSON.
     */
    toHSJSON() {
        let res = 'n:' + this.value.toString();
        if (this.unit !== undefined) {
            res += ' ' + this.unit;
        }

        return res;
    };

    /**
     * Emit Project Haystack ZINC.
     */
    toHSZINC() {
        let res = this.value.toString();
        if (this.unit !== undefined) {
            res += this.unit;
        }

        return res;
    };
}

module.exports = HSNumber;
