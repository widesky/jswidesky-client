class HisWritePayload {
    #payload
    #rows

    /**
     * Construct a HisWritePayload instance.
     * @param {Object} payload A payload to be used.
     */
    constructor(payload={}) {
        this.#payload = payload;
        this.#rows = Object.keys(payload).length === 0 ? 0 : HisWritePayload.calculateSize(payload);
    }

    /**
     * Calculate the number of rows to be written in a manually created hisWrite Object.
     * @param {Object} data Data to be checked.
     */
    static calculateSize(data) {
        let size = 0;
        for (const [ts, timeSeriesEntries] of Object.entries(data)) {
            size += Object.keys(timeSeriesEntries).length;
        }

        return size;
    }

    /**
     * Get hisWrite payload suitable for the hisWrite function of the WideSkyClient.
     * @returns {Object}
     */
    get payload() {
        return this.#payload;
    }

    /**
     * Get the number of rows added to the payload.
     * @returns {Number} Number of rows added.
     */
    get size() {
        return this.#rows;
    }

    /**
     * Add data to the hisWrite payload. If the unit is present on val attribute, it will be stripped.
     * @param id Entity id with Haystack prefix applied.
     * @param {[]} data Data of the format of [{ts: String, val: String}] with the Haystack prefix applied.
     */
    add(id, data) {
        if (typeof id !== "string") {
            throw new Error("Id must be a string");
        } else if (id.substring(0, 2) !== "r:") {
            throw new Error("Id must have Haystack reference type prefix applied");
        }

        for (const [i, {ts, val}] of data.entries()) {
            if (ts === undefined) {
                throw new Error("Row in data missing 'ts' property");
            }
            else if (val === undefined) {
                throw new Error("Row in data missing 'val' property");
            } else if (typeof val !== "string" && typeof val !== "boolean") {
                throw new Error(`'val' in row ${i} missing Haystack prefix`);
            }

            if (this.payload[ts] === undefined) {
                this.payload[ts] = {};
            }

            let parsedVal = val;
            if (typeof val === "string" && val.substring(0, 2) === "n:" && val.includes(" ")) {
                const index= val.indexOf(" ");
                if (index !== -1) {
                    // val has unit applied, remove
                    parsedVal = val.substring(0, val.indexOf(" "));
                }
            }
            this.#payload[ts][id] = parsedVal;
            this.#rows++;
        }
    }

    reset() {
        this.#payload = {};
        this.#rows = 0;
    }
}

module.exports = HisWritePayload;