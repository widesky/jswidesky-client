const { deriveFromDefaults } = require("../../utils/evaluator");
const HisWritePayload = require("../../utils/hisWritePayload");

async function hisWrite(hisWriteData, options={}) {
    if (!this.initialised) {
        await this.initWaitFor;
    }

    let payload = hisWriteData;
    if (hisWriteData instanceof HisWritePayload) {
        payload = hisWriteData.payload;
    }

    return this.performOpInBatch(
        "hisWrite",
        [payload],
        deriveFromDefaults(this.clientOptions.batch.hisWrite, options));
}

module.exports = {
    hisWrite
};