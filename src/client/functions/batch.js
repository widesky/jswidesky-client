const {
    deriveFromDefaults,
    PERFORM_OP_IN_BATCH_SCHEMA,
    BATCH_HIS_WRITE_SCHEMA,
    BATCH_HIS_READ_SCHEMA,
    BATCH_HIS_DELETE_SCHEMA
} = require("../../utils/evaluator");
const HisWritePayload = require("../../utils/hisWritePayload");
const { sleep } = require("../../utils/tools");
const Hs = require("../../utils/haystack");
const {value} = require("lodash/seq");

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
    } = deriveFromDefaults(this.clientOptions.performOpInBatch, options);

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
        if (ids.length === 1 || options.batchSize === 1) {
            resultByEntity[i] = res.rows;
        } else {
            // issues found with rows not being sorted by their respective time stamp
            // when doing multi hisRead
            const sortedRows = res.rows.sort((rowA, rowB) => {
                const timeA = Date.parse(Hs.removePrefix(rowA.ts));
                const timeB = Date.parse(Hs.removePrefix(rowB.ts));

                if (timeA > timeB) {
                    return 1;
                } else if (timeA < timeB) {
                    return -1;
                } else {
                    return 0;
                }
            });

            for (const row of sortedRows) {
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
 * Get the end time in the data set that has at most the given batchSize records.
 * @param dataSet Data set to search in.
 * @param grabFromIndex A start index to signify what will be batched next.
 * @param batchSize Maximum number of time series data that can be deleted.
 * @returns {number|null} The index of the endRange time found. If data set is empty, null is returned.
 */
function endTimeRange(dataSet, grabFromIndex, batchSize) {
    if (dataSet.length === 0 || grabFromIndex >= dataSet.length) {
        return null;
    }

    let i = grabFromIndex;
    while (i < dataSet.length - 1 && i - grabFromIndex + 1 < batchSize) {
        i++;
    }

    if (i > dataSet.length - 1) {
        // gone over. Select the end
        i = dataSet.length - 1
    }

    return Date.parse(Hs.removePrefix(dataSet[i].ts));
}

/**
 * Find the number of rows between the given times timeStart and timeEnd.
 * @param data Data to search within.
 * @param timeStart Starting epoch time range.
 * @param timeEnd Ending epoch time range.
 * @returns {number} Number of time series rows found.
 */
function rowsBetweenRange(data, timeStart, timeEnd) {
    let i = 0;
    let count = 0;
    const getDate = (ts) => Date.parse(Hs.removePrefix(ts));
    while (data[i] && getDate(data[i].ts) < timeStart) {
        i++;
    }

    if (data[i] === undefined) {
        // found start point exceeds data sets endpoint. No data between time range
        return 0;
    }

    for (; i < data.length; i++) {
        if (data[i] === undefined || getDate(data[i].ts) > timeEnd) {
            break;
        }
        count++;
    }

    return count;
}

/**
 * Find the time for which either the maximum number of time series rows are deleted or the batchSize of rows has been
 * reached.
 * @param timeRanges Array of Objects with property "endRange".
 * @param dataSet Data to search for the number of time series to be deleted from.
 * @param grabFrom Time stamp to grab from.
 * @param batchSize Maximum size of each batch.
 * @returns {{endRange, deleteRowCounts: number}} Return endRange to delete till and the number of rows to delete from
 *                                                each data set.
 */
function getMinIndex(timeRanges, dataSet, grabFrom, batchSize) {
    const sortByRange = timeRanges
        .filter((range, i) => range !== null)
        .sort((rangeA, rangeB) => {
            if (rangeA < rangeB) {
                return -1;
            } else if (rangeA > rangeB) {
                return 1;
            } else {
                return 0;
            }
    });

    let curMax, endRange, deleteRowCounts;
    for (let i = 0; i < sortByRange.length; i++) {
        if (curMax === undefined) {
            endRange = sortByRange[i];
            deleteRowCounts = dataSet
                .map((data) => rowsBetweenRange(data, grabFrom, sortByRange[i]));
            curMax = Math.max(...deleteRowCounts);
            if (curMax > batchSize) {
                // this ain't it chief
                curMax = undefined;
                continue;
            } else if (curMax === batchSize) {
                // already at maximum batch size
                break;
            } else {
                continue;
            }
        }

        const getDataCount = dataSet.map((data) =>
            rowsBetweenRange(data, grabFrom, sortByRange[i]));
        const maxDataCount = Math.max(...getDataCount);
        if (maxDataCount === batchSize) {
            // we're at max
            deleteRowCounts = getDataCount;
            curMax = maxDataCount;
            endRange = sortByRange[i];
            break;
        } else if (batchSize >= maxDataCount && maxDataCount > curMax ) {
            deleteRowCounts = getDataCount;
            curMax = maxDataCount;
            endRange = sortByRange[i];
        }
    }

    return { endRange, deleteRowCounts };
}
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
 * Find the earliest time range in the historical data.
 * @param data Data to search within.
 * @returns {Date} Date of the earlier time series found.
 */
function findStartTime(data) {
    let startTime = null;
    for (const dataSet of data) {
        if (dataSet.length > 0) {
            if (startTime === null) {
                startTime = Date.parse(Hs.removePrefix(dataSet[0].ts));
                continue;
            }
            const firstTime = Date.parse(Hs.removePrefix(dataSet[0].ts));
            if (firstTime < startTime) {
                startTime = firstTime;
            }
        }
    }

    return new Date(startTime);
}

/**
 * Create hisDelete time ranges to remove all the data given and append them to the given batch.
 * @param data Data to create time ranges for.
 * @param ids Entity IDs for who their data will be deleted.
 * @param batch The current batch to append hisDelete arguments to.
 * @param batchSize The maximum number of time series rows to be deleted per hisDelete range.
 * @param startTime The earliest time to be deleted.
 * @param timeEnd The requested end time range.
 */
function createTimeRanges(data, ids, batch, batchSize, startTime, timeEnd) {
    let grabFrom = startTime;
    const recordIndexes = new Array(ids.length).fill(0);
    while (!allAccountedFor(data, recordIndexes)) {
        const timeRanges = recordIndexes.map((_, index) =>
            endTimeRange(data[index], recordIndexes[index], batchSize));
        const { endRange, deleteRowCounts} = getMinIndex(timeRanges, data, grabFrom.valueOf(), batchSize);
        // ensure time range is inclusive of data to be deleted (i.e. +1ms)
        const grabTo = new Date(endRange + 1);
        if (grabTo.getTime() > timeEnd.getTime()) {
            // end of the line
            batch.push([ids, `s:${grabFrom.toISOString()},${timeEnd.toISOString()}`]);
            break;
        } else {
            batch.push([ids, `s:${grabFrom.toISOString()},${grabTo.toISOString()}`]);
        }

        grabFrom = grabTo;

        // update starting indexes
        for (let i = 0; i < recordIndexes.length; i++) {
            if (deleteRowCounts[i] !== 0) {
                recordIndexes[i] += deleteRowCounts[i];
            }
        }
    }
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

    const errorsEncountered = [];
    // Create time range batches in terms of each batch of ids
    const batches = init2DArray(idsAsBatch.length);
    for (let i = 0; i < idsAsBatch.length; i++) {
        let idsInBatch = idsAsBatch[i];
        const { success: data, errors } = await this.batch.hisRead(ids, timeStart, timeEnd);
        if (errors.length) {
            // pass the errors encountered to the user
            for (const error of errors) {
                errorsEncountered.push(error);
            }

            // purge the ids for which a hisRead could not be performed on
            const oldIdsInBatch = [...idsInBatch];
            idsInBatch = [];
            for (let i = 0; i < data.length; i++) {
                if (data[i].length !== 0) {
                    idsInBatch.push(oldIdsInBatch[i]);
                }
            }
        }

        if (data.filter((dataSet) => dataSet.length > 0).length === 0) {
            // no data to delete
            continue;
        }

        createTimeRanges(
            data,
            idsInBatch,
            batches[i],
            batchSize,
            findStartTime(data),
            timeEnd
        );
    }

    if (batches.filter((idBatch) => idBatch.length > 0).length === 0) {
        return {
            success: [],
            errors: errorsEncountered
        };
    }

    const batchFlattened = [];
    for (const idBatch of batches) {
        for (const batchForIds of idBatch) {
            batchFlattened.push(batchForIds);
        }
    }

    const opResult = await this.performOpInBatch(
        "hisDelete",
        [batchFlattened],
        {
            ...options,
            batchSize: 1,           // batches are based on the time ranges to be deleted
            transformer: (batch) => batch[0]
        }
    );

    // join the result with any errors encountered
    return {
        success: opResult.success,
        errors: [...errorsEncountered, ...opResult.errors]
    };
}

module.exports = {
    performOpInBatch,
    hisWrite,
    hisRead,
    hisDelete
};