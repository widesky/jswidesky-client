const yup = require("yup");

const HIS_READ_BATCH_SIZE = 100;
const HIS_READ_BATCH_SIZE_MAX = 1000;
const HIS_WRITE_BATCH_SIZE  = 10000;
const HIS_WRITE_MAX_BATCH_SIZE = 20000;
const HIS_DELETE_DATA_POINT_BATCH_SIZE = 1500;
const HIS_DELETE_DATA_POINT_BATCH_SIZE_MAX = 3000;
const HIS_DELETE_ENTITY_BATCH_SIZE = 100;
const HIS_DELETE_ENTITY_BATCH_SIZE_MAX = 1000;
const CREATE_BATCH_SIZE = 2000;
const UPDATE_BATCH_SIZE = 2000;
const DELETE_BATCH_SIZE = 30;

const PERFORM_OP_IN_BATCH_BATCH_SIZE = 100;
const PERFORM_OP_IN_BATCH_MAX_BATCH_SIZE = 10 ** 9;
const PERFORM_OP_IN_BATCH_MAX_PARALLEL = 100;

function deriveFromDefaults(defaultConfig, passedConfig) {
    for (const [key, value] of Object.entries(defaultConfig)) {
        if (passedConfig[key] === undefined) {
            passedConfig[key] = value;
        }
    }

    return passedConfig;
}

// Properties
const LIMIT_PROPERTY = {
    limit: yup.number()
        .nullable()
        .notRequired()
        .default(0)
        .strict()
        .min(0)
};

const getBatchProp = (defaultSize, maxSize=defaultSize, name="batchSize") => {
    return {
        [name]: yup.number()
            .notRequired()
            .nullable()
            .strict()
            .min(1)
            .max(maxSize)
            .default(defaultSize)
    }
};

const getReturnResultProp = (defaultVal) => {
    return {
        returnResult: yup.boolean()
            .strict()
            .default(defaultVal)
    }
};

// Shared Objects
const PERFORM_OP_IN_BATCH_OBJ = {
    ...getBatchProp(PERFORM_OP_IN_BATCH_BATCH_SIZE, PERFORM_OP_IN_BATCH_MAX_BATCH_SIZE),
    batchDelay: yup.number()
        .notRequired()
        .nullable()
        .strict()
        .min(0)
        .default(0),
    parallel: yup.number()
        .strict()
        .min(1)
        .max(PERFORM_OP_IN_BATCH_MAX_PARALLEL)
        .default(1),
    parallelDelay: yup.number()
        .notRequired()
        .nullable()
        .strict()
        .min(0)
        .default(0)
};

// Client function schema for options arguments
const BATCH_HIS_READ_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
});
const BATCH_HIS_WRITE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(HIS_WRITE_BATCH_SIZE, HIS_WRITE_MAX_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_HIS_DELETE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(HIS_DELETE_DATA_POINT_BATCH_SIZE, HIS_DELETE_DATA_POINT_BATCH_SIZE_MAX),
    ...getBatchProp(HIS_DELETE_ENTITY_BATCH_SIZE, HIS_DELETE_ENTITY_BATCH_SIZE_MAX, "batchSizeEntity"),
    ...getReturnResultProp(false)
});
const BATCH_CREATE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(CREATE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_UPDATE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(UPDATE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_DELETE_BY_ID_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(DELETE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_DELETE_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(DELETE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_HIS_READ_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(HIS_READ_BATCH_SIZE),
    ...LIMIT_PROPERTY
});
const BATCH_ADD_CHILDREN_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(CREATE_BATCH_SIZE),
    ...getReturnResultProp(false),
    ...LIMIT_PROPERTY
});
const BATCH_UPDATE_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(UPDATE_BATCH_SIZE),
    ...getReturnResultProp(false),
    ...LIMIT_PROPERTY
});
const BATCH_HIS_DELETE_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(HIS_DELETE_DATA_POINT_BATCH_SIZE),
    ...getReturnResultProp(false),
    ...LIMIT_PROPERTY
});
const BATCH_MIGRATE_HISTORY_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(HIS_WRITE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_UPDATE_OR_CREATE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getBatchProp(Math.min(CREATE_BATCH_SIZE, UPDATE_BATCH_SIZE)),
    ...getReturnResultProp(true)
});

const PERFORM_OP_IN_BATCH_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_OBJ,
    ...getReturnResultProp(false)
});

const PROGRESS_OBJ = {
    enable: yup.boolean()
        .nullable()
        .notRequired()
        .strict()
        .default(false),
    increment: yup.string()
        .nullable()
        .notRequired()
        .strict()
        .default("increment"),
    create: yup.string()
        .nullable()
        .notRequired()
        .strict()
        .default("create"),
    update: yup.string()
        .nullable()
        .notRequired()
        .strict()
        .default("update")
};

const CLIENT_SCHEMA = yup.object({
    impersonateAs: yup.string()
        .nullable()
        .notRequired()
        .strict()
        .default(null),
    acceptGzip: yup.boolean()
        .nullable()
        .notRequired()
        .strict()
        .default(true),
    progress: yup.object(PROGRESS_OBJ),
    batch: yup.object({
        hisRead: BATCH_HIS_READ_SCHEMA,
        hisWrite: BATCH_HIS_WRITE_SCHEMA,
        hisDelete: BATCH_HIS_DELETE_SCHEMA,
        create: BATCH_CREATE_SCHEMA,
        update: BATCH_UPDATE_SCHEMA,
        deleteById: BATCH_DELETE_BY_ID_SCHEMA,
        deleteByFilter: BATCH_DELETE_BY_FILTER_SCHEMA,
        hisReadByFilter: BATCH_HIS_READ_BY_FILTER_SCHEMA,
        addChildrenByFilter: BATCH_ADD_CHILDREN_BY_FILTER_SCHEMA,
        updateByFilter: BATCH_UPDATE_BY_FILTER_SCHEMA,
        migrateHistory: BATCH_MIGRATE_HISTORY_SCHEMA,
        hisDeleteByFilter: BATCH_HIS_DELETE_BY_FILTER_SCHEMA,
        updateOrCreate: BATCH_UPDATE_OR_CREATE_SCHEMA
    }),
    performOpInBatch: PERFORM_OP_IN_BATCH_SCHEMA
});

module.exports = {
    CLIENT_SCHEMA,
    PERFORM_OP_IN_BATCH_SCHEMA,
    BATCH_HIS_WRITE_SCHEMA,
    BATCH_HIS_READ_SCHEMA,
    BATCH_HIS_DELETE_SCHEMA,
    deriveFromDefaults
};