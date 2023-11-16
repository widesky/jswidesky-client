const {
    deriveFromDefaults,
    PERFORM_OP_IN_BATCH_SCHEMA,
    BATCH_HIS_WRITE_SCHEMA,
    BATCH_HIS_READ_SCHEMA,
    BATCH_HIS_DELETE_SCHEMA,
    BATCH_CREATE_SCHEMA,
    BATCH_UPDATE_SCHEMA,
    BATCH_DELETE_BY_ID_SCHEMA
} = require("../../utils/evaluator");
const HisWritePayload = require("../../utils/hisWritePayload");
const { sleep } = require("../../utils/tools");
const Hs = require("../../utils/haystack");

/**
 * Initialise a 2D empty array.
 * @param size Size of the 2D array.
 * @returns {*[]}
 */
function init2DArray(size) {
    const arr = [];
    for (let i = 0; i < size; i++) {
        arr.push([]);
    }

    return arr;
}

/**
 * Create a Iterator Object for the given payload.
 * @param op Operation to be performed. Only relevant for op "hisDelete".
 * @param payload Payload to be batched.
 * @param clientArgs Arguments to be grouped with the batched payload.
 * @param batchSize Maximum size of each batch. For Objects, it's the number of key-value pairs found in the Object
 *                  of each attribute specified in the Object. For Arrays, its number of elements.
 * @param transformer A transformer for the batched arguments.
 * @returns {{p1, hasMore: (function(): boolean), getNext}}
 */
function createBatchIterator(op, payload, clientArgs, batchSize, transformer) {
    let hasMore, getNext, p1;
    if (Array.isArray(payload)) {
        getNext = () => {
            const next = payload.splice(0, batchSize);
            if (op === "hisDelete") {
                // special case due to the arguments required
                return {
                    next: transformer(next),
                    size: next.length
                };
            } else {
                return {
                    next: [transformer(next), ...clientArgs],
                    size: next.length
                };
            }
        };
        hasMore = () => payload.length > 0;

        if (this.isProgressEnabled) {
            p1 = this.progressCreate(payload.length);
        }
    } else if (typeof payload === "object") {
        const payloadKeys = Object.keys(payload);
        const keyValueLength = payloadKeys.map((key) => Object.keys(payload[key]).length);
        let currKeyIndex = 0;
        getNext = () => {
            // get next set using batchSize as maximum number of rows, not inclusive of the key
            const next = {};
            let totalRows = 0;
            let currKey = payloadKeys[currKeyIndex];
            while (totalRows < batchSize && currKeyIndex < payloadKeys.length) {
                const currKeyEntries = Object.entries(payload[currKey]);
                const keyValueStartFrom = keyValueLength[currKeyIndex];
                if (currKeyEntries.length > (batchSize - totalRows) || keyValueStartFrom !== Object.keys(payload[currKey]).length) {
                    // take part of the set
                    const partTake = batchSize - totalRows;

                    if (next[currKey] === undefined) {
                        next[currKey] = {};
                    }

                    for (let i = keyValueStartFrom; i < partTake; i++) {
                        next[currKey][currKeyEntries[i][0]] = currKeyEntries[i][1];
                    }
                    keyValueLength[currKeyIndex] -= partTake;
                    totalRows += partTake;

                    if (keyValueLength[currKeyIndex] === 0) {
                        currKeyIndex++;
                        currKey = payloadKeys[currKeyIndex];
                    }
                } else {
                    next[currKey] = payload[currKey];
                    keyValueLength[currKeyIndex] = 0;
                    totalRows += currKeyEntries.length;
                    currKeyIndex++;
                    currKey = payloadKeys[currKeyIndex];
                }
            }

            return {
                next: [transformer(next), ...clientArgs],
                size: totalRows
            };
        }
        hasMore = () => currKeyIndex !== payloadKeys.length && keyValueLength[currKeyIndex] !== 0;

        if (this.isProgressEnabled) {
            p1 = this.progressCreate(Object.keys(payload).length);
        }
    } else {
        throw new Error("First element of parameter should be of type Array or Object");
    }

    return { hasMore, getNext, p1 };
}

/**
 * Create a request with success and error handlers.
 * @param op Client function to be performed.
 * @param args Arguments to be called for the client operation.
 * @param result Result Object to append success or error responses to.
 * @param returnResult If true, append the result of the operation to result.success. Do nothing otherwise.
 * @returns {Promise<unknown>}
 */
function createBatchRequest(op, args, result, returnResult) {
    return new Promise(async (resolve) => {
        try {
            const res = await this[op](...args);
            if (returnResult) {
                result.success.push(res);
            }
        } catch (error) {
            result.errors.push({
                error: error.message,
                args
            });
        } finally {
            resolve();
        }
    });
}

/**
 * Perform a WideSky client operation in batches or in parallel.
 * @param op Function to be called on the client instance.
 * @param args An Array of arguments to be passed to the client. The first index must be the batch'able payload.
 * @param options A Object of options available to configure the operation. These include:
 *                - batchSize: Size of each batch sent to API server. For a payload of type Object, this is the \
 *                             number of keys.
 *                - batchDelay: Delay in milliseconds between the completion of a request and the next request to be
 *                              made.
 *                - parallel: Number of batched requests to run in parallel.
 *                - parallelDelay: Delay in milliseconds between each set of parallel requests.
 *                - returnResult: Enable or disable returning the result of the queries sent.
 *                - transformer: A function to transform the payload to be passed to the client operation.
 */
async function performOpInBatch(op, args, options={}) {
    // evaluate options
    await PERFORM_OP_IN_BATCH_SCHEMA.validate(options);
    const {
        batchSize,
        batchDelay,
        returnResult,
        parallel,
        parallelDelay
    } = deriveFromDefaults(this.clientOptions.performOpInBatch, options)

    let { transformer } = options;
    if (transformer == null) {
        // no transformation
        transformer = (val) => val;
    }

    // Evaluate given args to be batched
    if (!Array.isArray(args) || args.length === 0) {
        throw new Error("args parameter must be an array consisting of at least the payload to be batched");
    }
    const payload = args[0];
    const clientArgs = args.slice(1);
    const result = {
        errors: [],
        success: []
    };
    const { getNext, hasMore, p1 } = createBatchIterator.call(this, op, payload, clientArgs, batchSize, transformer);
    if (!hasMore()) {
        return result;
    }

    let added = 0;
    while (hasMore()) {
        let sizeTotal = 0;
        const requests = [];

        // queue parallel requests
        for (let i = 0; i < parallel && hasMore(); i++) {
            const { next, size } = getNext();
            sizeTotal += size;
            requests.push(createBatchRequest.call(this, op, next, result, returnResult));
            if (batchDelay > 0) {
                await sleep(batchDelay);
            }
        }
        await Promise.all(requests);

        if (this.isProgressEnabled) {
            p1[this.clientOptions.progress.update](added += sizeTotal);
        }

        if (parallelDelay > 0)  {
            await sleep(parallelDelay);
        }
    }

    return result;
}

/**
 * Perform a hisWrite operation using batch functionality.
 * @param hisWriteData HisWrite data to be sent. Can be the raw hisWrite payload or an instance of HisWritePayload.
 * @param options A Object defining batch configurations to be used. See README.md for more information.
 *                Option batchSize is determined by the maximum number of time series rows to be sent. The rows are
 *                defined as the time series for each entity.
 * @returns {Promise<*>}
 */
async function hisWrite(hisWriteData, options={}) {
    if (!["Object", "HisWritePayload"].includes(hisWriteData.constructor.name)) {
        throw new Error("parameter hisWriteData must be of type Object");
    }

    await BATCH_HIS_WRITE_SCHEMA.validate(options);

    let data;
    if (hisWriteData instanceof HisWritePayload) {
        data = hisWriteData.payload;
    } else {
        data = hisWriteData;
    }
    options = deriveFromDefaults(this.clientOptions.batch.hisWrite, options);

    return this.performOpInBatch(
        "hisWrite",
        [data],
        options
    );
}

/**
 * Perform a history read request using batch functionality.
 * @param   ids Entities to read.
 * @param   from Haystack read range or a Date Object representing where to grab historical data from.
 * @param   to  Date Object representing where to grab historical data to (not inclusive).
 * @param   options A Object defining batch configurations to be used. See README.md for more information.
 *                  Option batchSize is determined by the number of ids to perform a hisRead for.
 * @returns A 2D array of time series data in the order of ids queried.
 */
async function hisRead(ids, from, to, options={}) {
    await BATCH_HIS_READ_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.hisRead, options);

    const {
        success: data,
        errors
    } = await this.performOpInBatch(
        "hisRead",
        [[...ids], from, to, options.batchSize],
        {
            ...options,
            returnResult: true
        }
    );

    // process hisRead data
    const resultByEntity = init2DArray(ids.length);
    for (let i = 0; i < data.length; i++) {
        const res = data[i];
        if (ids.length === 1) {
            resultByEntity[i] = res.rows;
        } else {
            for (const row of res.rows) {
                const { ts } = row;
                for (const [vId, val] of Object.entries(row)) {
                    if (vId === "ts") {
                        continue;
                    }

                    const index = Number(vId.slice(1));
                    resultByEntity[index].push({ts, val});
                }
            }
        }
    }

    return {
        success: resultByEntity,
        errors: errors
    };
}

/**
 * Get the end time and index in the data set that has at most the given batchSize records.
 * @param dataSet Data set to search in.
 * @param grabFromIndex A start index to signify what will be batched next.
 * @param batchSize
 * @returns {{endRange: number, index: number}|{endRange: null, index: null}}
 *      endRange: The epoch time that is either the end of the data set or batchSize indexes from the given
 *                grabFromIndex. If data set is empty, null is returned.
 *      index: The index of the endRange time found. If data set is empty, null is returned.
 */
function endTimeRange(dataSet, grabFromIndex, batchSize) {
    if (dataSet.length === 0) {
        return {
            endRange: null,
            index: null
        };
    }

    let i = grabFromIndex;
    while (i < dataSet.length - 1 && i - grabFromIndex + 1 < batchSize) {
        i++;
    }

    if (i > dataSet.length - 1) {
        // gone over. Select the end
        i = dataSet.length - 1
    }

    return {
        endRange: Date.parse(Hs.removePrefix(dataSet[i].ts)),
        index: i
    };
}

/**
 * Find the index in a given Array of Objects with property "endRange" which is an epoch time stamp
 * that is the smallest in the Array.
 * @param values Array of Objects with property "endRange".
 * @returns {null, number} Return the index in the Array given in values that has the earliest time stamp.
 */
function minWithIndex(values) {
    let minIndex = null;
    for (let i = 0; i < values.length; i++) {
        if (values[i].endRange === null) {
            continue;
        } else if (minIndex === null) {
            minIndex = i;
            continue;
        }

        if (values[i].endRange < values[minIndex].endRange) {
            minIndex = i;
        }
    }

    return minIndex;
};
/**
 * Determine if all time series data has been accounted for.
 * @returns {boolean} True if there is more data to work with. False if not.
 */
function allAccountedFor(data, recordIndexes) {
    for (let i = 0; i < recordIndexes.length; i++) {
        if (data[i].length > recordIndexes[i]) {
            return false;
        }
    }

    return true;
}

/**
 * Perform a history delete request using batch functionality.
 * @param ids An array of point entity UUIDs for the delete operations or a single string. These will be batched by
 *            options.batchSizeEntity.
 * @param range A valid hisRead range string. End range is not inclusive.
 * @param options A Object defining batch configurations to be used. See README.md for more information.
 *                Option batchSize is determined by the maximum number of time series rows to be deleted across
 *                all ids given.
 * @returns {Promise<void>}
 */
async function hisDelete(ids, range, options={}) {
    await BATCH_HIS_DELETE_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.hisDelete, options);
    const { batchSize, batchSizeEntity } = options;

    // validate hisRead range given
    if (!range.includes(",")) {
        throw new Error("'range' parameter is not a valid hisRead range");
    }
    const [timeStart, timeEnd] = range.split(",")
        .map((timeStr) => new Date(Date.parse(timeStr.trim())));
    if (isNaN(timeStart) || isNaN(timeEnd)) {
        throw new Error("'range' parameter is not a valid hisRead range");
    }

    // Create batch of ids
    let idsAsBatch = [];
    if (ids.length > batchSizeEntity) {
        const idsCopy = [...ids];
        while (idsCopy.length) {
            idsAsBatch.push(idsCopy.splice(0, batchSizeEntity));
        }
    } else {
        idsAsBatch.push(ids);
    }

    // Create time range batches in terms of each batch of ids
    const batches = init2DArray(idsAsBatch.length);
    for (let batchIndex = 0; batchIndex < idsAsBatch.length; batchIndex++) {
        const idsInBatch = idsAsBatch[batchIndex];
        const data = await this.batch.hisRead(ids, timeStart, timeEnd);
        if (data.filter((dataSet) => dataSet.length > 0).length === 0) {
            // no data to delete
            return;
        }

        // find start point
        let startTime = null;
        for (const dataSet of data) {
            if (dataSet.length > 0) {
                if (startTime === null) {
                    startTime = new Date(Date.parse(Hs.removePrefix(dataSet[0].ts)));
                    continue;
                }
                const firstTime = new Date(Date.parse(Hs.removePrefix(dataSet[0].ts)));
                if (firstTime.getTime() < startTime.getTime()) {
                    startTime = firstTime;
                }
            }
        }
        let grabFrom = startTime;
        const recordIndexes = new Array(ids.length).fill(0);

        // Create the time ranges to be batched for hisDeletion
        // const batches = [];
        const indexes = ids.map((_) => 0);
        while (!allAccountedFor(data, recordIndexes)) {
            const timeRanges = recordIndexes.map((_, index) =>
                endTimeRange(data[index], recordIndexes[index], batchSize));
            const minIndex = minWithIndex(timeRanges);
            // ensure time range is inclusive of data to be deleted (i.e. +1ms)
            const grabTo = new Date(timeRanges[minIndex].endRange + 1);

            if (grabTo.getTime() > timeEnd.getTime()) {
                // end of the line
                batches[batchIndex].push([idsInBatch, `s:${grabFrom.toISOString()},${timeEnd.toISOString()}`]);
                break;
            } else {
                batches[batchIndex].push([idsInBatch, `s:${grabFrom.toISOString()},${grabTo.toISOString()}`]);
            }
            grabFrom = grabTo;

            // update starting indexes
            for (let i = 0; i < recordIndexes.length; i++) {
                recordIndexes[i] = timeRanges[minIndex].index + 1;
            }
        }
    }

    const batchFlattened = [];
    for (const idBatch of batches) {
        for (const batchForIds of idBatch) {
            batchFlattened.push(batchForIds);
        }
    }

    return this.performOpInBatch(
        "hisDelete",
        [batchFlattened],
        {
            ...options,
            batchSize: 1,           // batches are based on the time ranges to be deleted
            transformer: (batch) => batch[0]
        }
    );
}

/**
 * Perform a create request using batch functionality. The request are batched based on the number of entities given.
 * @param entities Entities to be created.
 * @param options A Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<*>}
 */
async function create(entities, options={}) {
    await BATCH_CREATE_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.create, options);

    return this.performOpInBatch("create", [[...entities]], options);
}

/**
 * Perform an update requesting using batch functionality. The request are batched based on the number
 * of entities given.
 * @param entities Entities and respective tags to be updated.
 * @param options A Object defining batch configuration to be used. See README.md for more information.
 * @returns {Promise<*>}
 */
async function update(entities, options={}) {
    await BATCH_UPDATE_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.update, options);

    return this.performOpInBatch("update", [[...entities]], options);
}

/**
 * Perform a deleteById operation using batch functionality. The request are batched based on the number of entities
 * given.
 * @param ids The id of each entity to be deleted.
 * @param options A Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<*>}
 */
async function deleteById(ids, options={}) {
    await BATCH_DELETE_BY_ID_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.deleteById, options);

    return this.performOpInBatch("deleteById", [[...ids]], options);
}

module.exports = {
    performOpInBatch,
    hisWrite,
    hisRead,
    hisDelete,
    create,
    update,
    deleteById
};