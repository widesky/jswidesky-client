const yup = require("yup");

const HIS_READ_BATCH_SIZE = 100;
const HIS_WRITE_BATCH_SIZE  = 2000;
const HIS_DELETE_DATA_POINT_BATCH_SIZE = 1500;
const HIS_DELETE_ENTITY_BATCH_SIZE = 100;
const CREATE_BATCH_SIZE = 2000;
const UPDATE_BATCH_SIZE = 2000;
const DELETE_BATCH_SIZE = 30;
const PERFORM_OP_IN_BATCH_BATCH_SIZE = 100;

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

const getBatchProp = (defaultSize) => {
    return {
        batchSize: yup.number()
            .notRequired()
            .nullable()
            .strict()
            .default(defaultSize)
    }
};

const getReturnResultProp = (defaultVal) => {
    return {
        returnResult: yup.boolean()
            .strict()
            .default(defaultVal)
    }
}

// Shared Objects
const PERFORM_OP_IN_BATCH_ObJ = {
    ...getBatchProp(PERFORM_OP_IN_BATCH_BATCH_SIZE),
    ...getReturnResultProp(false),
    batchDelay: yup.number()
        .notRequired()
        .nullable()
        .strict()
        .default(0),
    parallel: yup.number()
        .strict()
        .default(1),
    parallelDelay: yup.number()
        .notRequired()
        .nullable()
        .strict()
        .default(0)
};

// Client function schema for options arguments
const BATCH_HIS_READ_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(HIS_READ_BATCH_SIZE)
});
const BATCH_HIS_WRITE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(HIS_WRITE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_HIS_DELETE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(HIS_DELETE_DATA_POINT_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_CREATE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(CREATE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_UPDATE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(UPDATE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_DELETE_BY_ID_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(DELETE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_DELETE_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(DELETE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_HIS_READ_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(HIS_READ_BATCH_SIZE),
    ...LIMIT_PROPERTY
});
const BATCH_ADD_CHILDREN_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(CREATE_BATCH_SIZE),
    ...getReturnResultProp(false),
    ...LIMIT_PROPERTY
});
const BATCH_UPDATE_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(UPDATE_BATCH_SIZE),
    ...getReturnResultProp(false),
    ...LIMIT_PROPERTY
});
const BATCH_HIS_DELETE_BY_FILTER_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(HIS_DELETE_DATA_POINT_BATCH_SIZE),
    ...getReturnResultProp(false),
    ...LIMIT_PROPERTY
});
const BATCH_MIGRATE_HISTORY_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(HIS_WRITE_BATCH_SIZE),
    ...getReturnResultProp(false)
});
const BATCH_UPDATE_OR_CREATE_SCHEMA = yup.object({
    ...PERFORM_OP_IN_BATCH_ObJ,
    ...getBatchProp(Math.min(CREATE_BATCH_SIZE, UPDATE_BATCH_SIZE)),
    ...getReturnResultProp(true)
});
const PERFORM_OP_IN_BATCH_SCHEMA = yup.object(PERFORM_OP_IN_BATCH_ObJ);

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
        .default("create")
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
    performOpInBatch: yup.object(PERFORM_OP_IN_BATCH_ObJ)
});

module.exports = {
    CLIENT_SCHEMA,
    PERFORM_OP_IN_BATCH_SCHEMA,
    deriveFromDefaults
}