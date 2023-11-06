class HisWritePayload {
    constructor() {
        this.payload = {};
    }

    /**
     * Add data to the hisWrite payload.
     * @param id Entity id with Haystack prefix applied.
     * @param data Data of the format of [{ts: String, val: String}] with the Haystack prefix applied.
     */
    add(id, data) {
        for (const {ts, val} of data) {
            if (ts === undefined) {
                throw new Error("Row in data missing 'ts' property");
            }
            else if (val === undefined) {
                throw new Error("Row in data missing 'val' property");
            }

            if (this.payload[ts] === undefined) {
                this.payload[ts] = {};
            }

            this.payload[ts][id] = val;
        }
    }

    reset() {
        this.payload = {};
    }
}

module.exports = HisWritePayload;