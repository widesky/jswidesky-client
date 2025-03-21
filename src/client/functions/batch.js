const {
    deriveFromDefaults,
    PERFORM_OP_IN_BATCH_SCHEMA,
    BATCH_HIS_WRITE_SCHEMA,
    BATCH_HIS_READ_SCHEMA,
    BATCH_HIS_DELETE_SCHEMA,
    BATCH_CREATE_SCHEMA,
    BATCH_UPDATE_SCHEMA,
    BATCH_DELETE_BY_ID_SCHEMA,
    BATCH_DELETE_BY_FILTER_SCHEMA,
    BATCH_HIS_READ_BY_FILTER_SCHEMA,
    BATCH_UPDATE_BY_FILTER_SCHEMA,
    BATCH_HIS_DELETE_BY_FILTER_SCHEMA,
    BATCH_MIGRATE_HISTORY_SCHEMA,
    BATCH_ADD_CHILDREN_BY_FILTER_SCHEMA,
    BATCH_MULTI_FIND_SCHEMA,
    BATCH_UPDATE_OR_CREATE_SCHEMA
} = require("../../utils/evaluator");
const HisWritePayload = require("../../utils/hisWritePayload");
const { sleep } = require("../../utils/tools");
const Hs = require("../../utils/haystack");
const EntityCriteria = require("../../utils/EntityCriteria");

const ID_TAGS = ["id", "fqname"];
const VIRTUAL_TAGS = ["lastHisTime", "lastHisVal", "curVal", "curStatus", "curErr"];

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
 * Determine if the time series rows given is already sorted in ascending order.
 * @param rows Time series rows.
 * @returns {boolean} True if already sorted, false otherwise.
 */
function isRowsSorted(rows) {
    let before;
    for (const {ts} of rows) {
        const epoch = Date.parse(Hs.removePrefix(ts));
        if (before === undefined) {
            before = epoch;
        }

        if (epoch < before) {
            return false;
        }
    }

    return true;
}

/**
 * Create an iterator Object for the given payload.
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
        // check if structure is as expected
        for (const [key, valueAsObject] of Object.entries(payload)) {
            if (typeof payload !== "object") {
                throw new Error("Object payload structure for batch operation is malformed");
            }
        }

        const payloadKeys = Object.keys(payload);
        const keyValueLength = payloadKeys.map((key) => Object.keys(payload[key]).length);
        const keyValueRemaining = [...keyValueLength];
        let currKeyIndex = 0;
        getNext = () => {
            // get next set using batchSize as maximum number of rows, not inclusive of the key
            const next = {};
            let totalRows = 0;
            while (totalRows < batchSize && currKeyIndex < payloadKeys.length) {
                if (keyValueRemaining[currKeyIndex] === 0) {
                    // all data fetched from here
                    currKeyIndex++;
                    continue;
                }

                const currKey = payloadKeys[currKeyIndex];
                const currKeyEntries = Object.entries(payload[currKey]);
                const keyRemaining = keyValueRemaining[currKeyIndex];
                const keyMax = keyValueLength[currKeyIndex]
                const keyValueStartFrom = keyMax - keyRemaining;
                if (currKeyEntries.length > (batchSize - totalRows) || keyValueStartFrom !== Object.keys(payload[currKey]).length) {
                    // take part of the set that doesn't exceed the current batch size
                    if (next[currKey] === undefined) {
                        next[currKey] = {};
                    }

                    let taken = 0;
                    const partTake = batchSize - totalRows;
                    for (let i = keyValueStartFrom; i - keyValueStartFrom < partTake && i < keyMax; i++) {
                        next[currKey][currKeyEntries[i][0]] = currKeyEntries[i][1];
                        taken++;
                    }
                    keyValueRemaining[currKeyIndex] -= taken;
                    totalRows += taken;
                } else {
                    next[currKey] = payload[currKey];
                    keyValueRemaining[currKeyIndex] = 0;
                    totalRows += currKeyEntries.length;
                    currKeyIndex++;
                }
            }

            return {
                next: [transformer(next), ...clientArgs],
                size: totalRows
            };
        }
        hasMore = () => {
            // skip over empty data sets
            while (currKeyIndex < payloadKeys.length && keyValueRemaining[currKeyIndex] === 0) {
                currKeyIndex++;
            }
            return currKeyIndex !== payloadKeys.length && keyValueLength[currKeyIndex] !== 0
        };

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
                args: [op, ...args]
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
 * @param options An Object of options available to configure the operation. These include:
 *                - batchSize: Size of each batch sent to API server. For a payload of type Object, this is the \
 *                             number of keys.
 *                - batchDelay: Delay in milliseconds between the completion of a request and the next request to be
 *                              made.
 *                - parallel: Number of batched requests to run in parallel.
 *                - parallelDelay: Delay in milliseconds between each set of parallel requests.
 *                - returnResult: Enable or disable returning the result of the queries sent.
 *                - transformer: A function to transform the payload to be passed to the client operation.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Contain the responses of successful operations when options.returnResult is true.
 *          - errors: Contain an errors encountered when performing operations.
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
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 *                Option batchSize is determined by the maximum number of time series rows to be sent. The rows are
 *                defined as the time series for each entity.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Contain the responses of successful operations of hisWrite when options.returnResult is true.
 *          - errors: Contain an errors encountered when performing operations.
 */
async function hisWrite(hisWriteData, options={}) {
    if (!["Object", "HisWritePayload"].includes(hisWriteData.constructor.name)) {
        throw new Error("parameter hisWriteData must be of type Object");
    }

    let data, size;
    if (hisWriteData instanceof HisWritePayload) {
        data = hisWriteData.payload;
        size = hisWriteData.size;
    } else {
        data = hisWriteData;
        size = HisWritePayload.calculateSize(hisWriteData);
    }
    if (size === 0) {
        throw new Error("Nothing to hisWrite");
    }

    await BATCH_HIS_WRITE_SCHEMA.validate(options);
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
 * @param   options An Object defining batch configurations to be used. See README.md for more information.
 *                  Option batchSize is determined by the number of ids to perform a hisRead for.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: A 2D array of time series data in the order of ids queried.
 *          - errors: Contain an errors encountered when performing operations.
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
            if (!isRowsSorted(res.rows)) {
                // issues found with rows not being sorted by their respective time stamp
                // when doing multi hisRead. Not a common use scenario but this an expectation for all
                // function that use WideSkyClient.batch.hisRead
                res.rows.sort((rowA, rowB) => {
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
            }

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
        .filter((range) => range !== null)
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
 * Perform a history delete request using batch functionality. A hisRead will be performed for the ids and range given
 * to determine how the hisDelete ranges should be split to have at most options.batchSize time series rows deleted.
 * The option batchSizeEntity will also impact the number of entities involved when performing a hisRead operation.
 * @param ids An array of point entity UUIDs for the delete operations or a single string. These will be batched by
 *            options.batchSizeEntity.
 * @param timeStart Starting timestamp to be deleted as a Date Object.
 * @param timeEnd Ending timestamp to be deleted as a Date Object (not inclusive).
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 *                Option batchSize is determined by the maximum number of time series rows to be deleted across
 *                all ids given.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the responses of hisDelete operations if options.returnResult is true.
 *          - errors: Return the errors encountered from hisDelete operations.
 */
async function hisDelete(ids, timeStart, timeEnd, options={}) {
    if (!(timeStart instanceof Date) || !(timeEnd instanceof Date)) {
        throw new Error("parameter timeStart or timeEnd is not of type Date");
    }

    await BATCH_HIS_DELETE_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.hisDelete, options);
    const { batchSize, batchSizeEntity } = options;

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
        let { success: data, errors } = await this.batch.hisRead(idsInBatch, timeStart, timeEnd);
        if (errors.length) {
            // pass the errors encountered to the user
            for (const error of errors) {
                errorsEncountered.push(error);
            }

            // purge the ids and data for which a hisRead could not be performed on
            const newIds = [];
            const newData = [];
            for (let i = 0; i < data.length; i++) {
                if (data[i].length !== 0) {
                    newIds.push(idsInBatch[i]);
                    newData.push(data[i]);
                }
            }
            data = newData;
            idsInBatch = newIds;
        }

        if (idsInBatch.length === 0 || data.filter((dataSet) => dataSet.length > 0).length === 0) {
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

/**
 * Perform a create request using batch functionality. The request are batched based on the number of entities given.
 * @param entities Entities to be created.
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful create operation if options.returnResult is true.
 *          - errors: Return the errors encountered for each failed create operation.
 */
async function create(entities, options={}) {
    await BATCH_CREATE_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.create, options);
    return this.performOpInBatch("create", [[...entities]], options);
}

/**
 * Perform an update requesting using batch functionality. The request are batched based on the number of entities given.
 * @param entities Entities and their respective tags to be updated.
 * @param options An Object defining batch configuration to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful update operation if options.returnResult is true.
 *          - errors: Return the errors encountered for each failed update operation.
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
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful update operation if options.returnResult is true.
 *          - errors: Return the errors encountered for each failed update operation.
 */
async function deleteById(ids, options={}) {
    await BATCH_DELETE_BY_ID_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.deleteById, options);

    return this.performOpInBatch("deleteById", [[...ids]], options);
}

/**
 * Perform a deleteByFilter operation using batch functionality. The request are batched based on the number of entities
 * retrieved from the given filter and limit. The batched payloads are passed to WideSkyClient.deleteById.
 * @param filter Filter to search for entities.
 * @param limit Limit to be imposed on the result of the given filter.
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful deleteByID operation if options.returnResult is true.
 *          - errors: Return the errors encountered for each failed deleteById operation.
 */
async function deleteByFilter(filter, limit=0, options={}) {
    await BATCH_DELETE_BY_FILTER_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.deleteByFilter, options);

    try {
        return this.performOpInBatch(
            "deleteById",
            [
                await this.findAsId(filter, limit)
            ],
            options
        );
    } catch (error) {
        return {
            success: [],
            errors: [{
                error: error.message,
                args: ["findAsId", filter, limit]
            }]
        };
    }
}

/**
 * Perform a hisRead using a filter to select the entities with batch functionality.
 * @param filter Filter to search for entities.
 * @param from Haystack read range or a Date Object representing where to grab historical data from.
 * @param to  Date Object representing where to grab historical data to (not inclusive).
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful hisRead operation if options.returnResult is true.
 *          - errors: Return the errors encountered for each failed hisRead operation.
 */
async function hisReadByFilter(filter, from, to, options={}) {
    await BATCH_HIS_READ_BY_FILTER_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.hisReadByFilter, options);
    const { limit } = options;

    try {
        return this.batch.hisRead(
            await this.findAsId(filter, limit),
            from,
            to,
            options
        );
    } catch (error) {
        return {
            success: [],
            errors: [{
                error: error.message,
                args: ["findAsId", filter, limit]
            }]
        };
    }
}

/**
 * Update the entities found in the filter by the given list of criteria using batch functionality.
 * @param filter Filter to search for entities.
 * @param criteriaList A list of EntityCriteria objects defining the criteria to match against.
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful update operation if options.returnResult is true.
 *          - errors: Return the errors encountered for each failed update operation.
 */
async function updateByFilter(filter, criteriaList, options={}) {
    for (const criteria of criteriaList) {
        if (!(criteria instanceof EntityCriteria)) {
            throw new Error("Element of parameter 'criteriaList' is not of class EntityCriteria");
        }
    }

    await BATCH_UPDATE_BY_FILTER_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.updateByFilter, options);
    const { limit } = options;

    let entities;
    try {
        entities = await this.v2.find(filter, limit);
    } catch (error) {
        return {
            success: [],
            errors: [{
                error: error.message,
                args: ["v2.find", filter, limit]
            }]
        };
    }

    const updatePayload = [];
    for (const entity of entities) {
        const newEntity = {
            id: entity.id
        };
        for (const criteria of criteriaList) {
            if (criteria.isValid(entity)) {
                criteria.applyChanges(newEntity, entity);
            }
        }

        if (Object.keys(newEntity).length > 1) {
            updatePayload.push(newEntity);
        }
    }

    return this.performOpInBatch("update", [updatePayload], options);
}

/**
 * Perform a hisDelete using a filter to select the entities.
 * @param filter Filter to select the entities to be hisDelete'd.
 * @param start Starting timestamp to be deleted as a Date Object.
 * @param end Ending timestamp to be deleted as a Date Object (not inclusive).
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 *                Option batchSize is determined by the maximum number of time series rows to be deleted across
 *                all ids given.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of each successful hisDelete operation when options.returnResult is true.
 *          - errors: Return any errors encountered when performing hisDelete operations.
 */
async function hisDeleteByFilter(filter, start, end, options={}) {
    await BATCH_HIS_DELETE_BY_FILTER_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.hisDeleteByFilter, options);
    const { limit } = options;

    try {
        return this.batch.hisDelete(
            await this.findAsId(filter, limit),
            start,
            end,
            options
        );
    } catch (error) {
        return {
            success: [],
            errors: [{
                error: error.message,
                args: ["findAsId", filter, limit]
            }]
        };
    }
}

/**
 * Perform a historical data migration between fromEntity and toEntity using batch functionality.
 * @param fromEntity The entity to migrate data from as a UUID or fqname.
 * @param toEntity The entity to migrate data to as a UUID or fqname.
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 *                Option batchSize is determined by the maximum number of time series rows to be sent. The rows are
 *                defined as the time series for each entity.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the success hisWrite data that has been migrated to toEntity if options.returnResult
 *            is true.
 *          - errors: Return all errors encountered.
 */
async function migrateHistory(fromEntity, toEntity, options={}) {
    await BATCH_MIGRATE_HISTORY_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.migrateHistory, options);

    const from = new Date(0);
    const to = new Date(Date.now());
    const res = await this.batch.hisRead([fromEntity], from, to);
    if (res.errors.length) {
        return res;
    }

    const { success: [history], errors } = res;
    const data = new HisWritePayload();
    data.add(`r:${toEntity}`, history);

    return this.batch.hisWrite(data, options);
}

/**
 * Add the given children the parents found in the given filter.
 * @param filter Filter to define the parents.
 * @param children Children to be added to the found parents.
 * @param tagMap A 2D Array of tags to be copied from the parent (if present) to the child entities.
 *                Each element of the Array is an Array with elements as [tagOfParent, toTagOnChild].
 *                For example [["id", "equipRef"]].
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: Return the result of the create operations performed when options.returnResult is true.
 *          - errors: Return an errors encountered from the create operations performed.
 */
async function addChildrenByFilter(filter, children, tagMap=[], options={}) {
    if (!Array.isArray(children) || children.filter((arr) => typeof arr !== "object").length) {
        throw new Error("parameter children is not an Array of Objects");
    } else if (children.length === 0) {
        throw new Error("parameter children is an empty Array");
    } else if (!Array.isArray(tagMap) || tagMap.filter((tags) => !Array.isArray(tags) || tags.length !== 2).length) {
        throw new Error("parameter refTags is not a 2D Array as specified");
    }

    await BATCH_ADD_CHILDREN_BY_FILTER_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.addChildrenByFilter, options);
    const { limit } = options;

    const parents = await this.v2.find(filter, limit);
    const createPayload = [];
    for (const parent of parents) {
        for (const child of JSON.parse(JSON.stringify(children))) {
            let added = false;
            for (const [tagOfParent, toTagOnChild] of tagMap) {
                if (parent[tagOfParent] !== undefined) {
                    added = true;
                    child[toTagOnChild] = parent[tagOfParent];
                }
            }

            if (added) {
                createPayload.push(child);
            }
        }
    }

    if (createPayload.length > 0) {
        return this.performOpInBatch(
            "create",
            [createPayload],
            options
        );
    }
}

/**
 * Create a read by filter using GraphQL
 * @param alias Filter alias name.
 * @param filter Read byu filter to be used.
 * @param limit Limit of entities to be searched.
 * @returns {string} GraphQL query.
 */
function getReadByFilterQuery(alias, filter, limit) {
    filter = filter.replaceAll('"', '\\"');
    return `
    ${alias}:search(filter: "${filter}", limit: ${limit}) {
      entity {
        tags {
          name
          value
          kindValue { __typename }
        }
      }
    }
    `
}

/**
 * Perform multi read-by-filter requests in a single request. The number of filters sent in a request is determined
 * by options.batchSize.
 * @param filterAndLimits A 2D Array defining the filter and limit of each read-by-filter to be queried.
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>}
 *          - success: A 2D Array of the result from each read-by-filter given.
 *          - errors: All errors encountered from performing read-by-filter operations.
 */
async function multiFind(filterAndLimits, options={}) {
    if (!Array.isArray(filterAndLimits) ||
            filterAndLimits.filter((fAndL) => !Array.isArray(fAndL) || fAndL.length === 0).length) {
        throw new Error("parameter filterAndLimits is not a 2D Array as specified");
    }

    await BATCH_MULTI_FIND_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.multiFind, options);
    const { limit } = options;

    // Build the GraphQL queries
    const queries = [];
    for (let i = 0; i < filterAndLimits.length; i++) {
        let [filter, limitFound] = filterAndLimits[i];
        if (limitFound === undefined) {
            limitFound = limit;
        }

        queries.push(getReadByFilterQuery(`filter${i}`, filter, limitFound));
    }

    /**
     * Transform the read by filter sub queries to be a single GraphQL query.
     * @param payload Payload of sub filter queries.
     * @returns String single GraphQL query.
     */
    const transformer = (payload) => {
        return `
{
  haystack {
    ${payload.join("\n")}
  }
}
            `;
    }
    const { success, errors } = await this.performOpInBatch(
        "query",
        [queries],
        {
            ...options,
            returnResult: true,
            transformer
        }
    )

    // parse the batched results
    const parsedResult = [];
    for (const res of success) {
        for (const filter of Object.values(res.data.haystack)) {
            const filterResult = [];
            for (const entity of filter.entity) {
                const newEntity = {};
                for (const {name, value, kindValue} of entity.tags) {
                    let kindType = "Zero";
                    if (kindValue !== null && kindValue !== undefined) {
                        kindType = kindValue["__typename"];
                    }
                    newEntity[name] = Hs.toHaystack(value, kindType)
                }
                filterResult.push(newEntity);
            }

            parsedResult.push(filterResult);
        }
    }


    return {
        success: parsedResult,
        errors
    };
}

/**
 * Create a update payload when comparing the changes between oldEntity and newEntity.
 * @param oldEntity Old entity to compare changes against.
 * @param newEntity New entity whose changed we'd like to make current.
 * @param logger Bunyan logging instance.
 * @returns {{id}} A updateRec payload.
 */
const createUpdatePayload = (oldEntity, newEntity, logger) => {
    const updatePayload = {
        id: newEntity.id
    };
    // what's new and what's changed?
    for (const [tag, value] of Object.entries(newEntity)) {
        if (ID_TAGS.includes(tag) || VIRTUAL_TAGS.includes(tag)) {
            logger.debug("Ignoring tag %s and value %s for entity %s.", tag, value, newEntity.id);
            continue;
        }

        if (oldEntity[tag] === undefined) {
            updatePayload[tag] = value;
        } else if (Array.isArray(value) && Array.isArray(oldEntity[tag])) {
            if (value.length !== oldEntity[tag].length) {
                // Not the same, no need to verify
                updatePayload[tag] = value;
            }

            // verify list changes
            let isDifferent = false;
            for (const item of value) {
                if (!(oldEntity[tag].includes(item))) {
                    isDifferent = true;
                    break;
                }
            }

            if (isDifferent) {
                updatePayload[tag] = value;
            }
        } else if (oldEntity[tag] !== value) {
            if (tag.includes("Ref") || ["metaOf"].includes(tag)) {
                // Ref can be different by the ID is what matters here
                if (Hs.getId(oldEntity, tag) !== Hs.getId(newEntity, tag)) {
                    updatePayload[tag] = value;
                }
            } else {
                updatePayload[tag] = value;
            }
        }
    }

    // what's removed?
    for (const tag in oldEntity) {
        if (ID_TAGS.includes(tag) || VIRTUAL_TAGS.includes(tag)) {
            continue;
        }

        if (newEntity[tag] === undefined) {
            updatePayload[tag] = "x:";
        }
    }

    return updatePayload;
}

/**
 * Perform an update or create request for the list of entities given. If the entity exists, the entity will be
 * checked for changes if an update is required, and send a request as necessary. If the entity does not exist, it
 * will be created.
 * @param entities Array of entities to be updated or created.
 * @param options An Object defining batch configurations to be used. See README.md for more information.
 * @returns {Promise<{success: *[], errors: [{args: (string|*)[], error}]}|*>}
 *          - success: Array of entities in their current state in the WideSky database.
 *          - errors: Any errors encountered during create or update operations.
 */
async function updateOrCreate(entities, options={}) {
    if (!Array.isArray(entities)) {
        throw new Error("parameter entities is not an Array");
    } else if (entities.length === 0) {
        this.logger.debug("No entities given.");
        return {
            success: [],
            errors: []
        };
    }

    await BATCH_UPDATE_OR_CREATE_SCHEMA.validate(options);
    options = deriveFromDefaults(this.clientOptions.batch.updateOrCreate, options);
    const { returnResult } = options;

    const createPayload = [];
    const updatePayload = [];
    let returnedEntities = [];    // List of entities in their current state as updated/created
    const skipIndex = new Array(entities.length);

    const idsFilter = [];
    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (entity.id === undefined) {
            this.logger.debug(`No id found for entity at index %d. Assuming creation.`, i);
            createPayload.push(entity);
            skipIndex[i] = true;
        } else {
            // filter and limit
            idsFilter.push([`id==@${Hs.getId(entity)}`, 1]);
        }
    }
    const {
        success: currentEntities,
        errors: findErrors
    } = await this.batch.multiFind(idsFilter);
    if (findErrors.length) {
        return {
            success: [],
            errors: findErrors
        };
    }

    for (let i = 0; i < entities.length; i++) {
        if (skipIndex[i]) {
            continue;
        }

        const entity = entities[i];
        const existingEntity = currentEntities[i][0];

        if (existingEntity === undefined) {
            createPayload.push(entity);
        } else {
            const entityUpdate = createUpdatePayload(existingEntity, entity, this.logger);
            if (Object.keys(entityUpdate).length > 1) {
                updatePayload.push(entityUpdate);
            } else {
                // nothing has changed
                if (returnResult) {
                    returnedEntities.push(entity);
                }
            }
        }
    }

    if (createPayload.length === 0 && updatePayload.length === 0) {
        this.logger.debug("Nothing to update or create.");
        return {
            success: entities,
            errors: []
        };
    }

    const requests = [];
    if (createPayload.length > 0) {
        this.logger.debug("Creating %d entities.", createPayload.length);
        requests.push(this.batch.create(createPayload, options));
    }
    else {
        this.logger.debug("Nothing to create.");
    }
    if (updatePayload.length > 0) {
        this.logger.debug("Updating %d entities.", updatePayload.length);
        requests.push(this.batch.update(updatePayload, options));
    } else {
        this.logger.debug("Nothing to update");
    }

    const allErrors = [];
    for (const { success, errors } of await Promise.all(requests)) {
        if (success.length && returnResult) {
            for (const { rows } of success) {
                for (const row of rows) {
                    returnedEntities.push(row);
                }
            }
        }

        for (const error of errors) {
            allErrors.push(error);
        }
    }

    return {
        success: returnedEntities,
        errors: allErrors
    };
}

module.exports = {
    performOpInBatch,
    hisWrite,
    hisRead,
    hisDelete,
    create,
    update,
    deleteById,
    deleteByFilter,
    hisReadByFilter,
    updateByFilter,
    hisDeleteByFilter,
    migrateHistory,
    addChildrenByFilter,
    multiFind,
    updateOrCreate
};
