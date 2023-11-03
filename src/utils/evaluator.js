const yup = require("yup");
const cliProgress = require("cli-progress");

const HIS_READ_BATCH_SIZE = 100;
const HIS_WRITE_BATCH_SIZE  = 2000;
const HIS_DELETE_DATA_POINT_BATCH_SIZE = 1500;
const HIS_DELETE_ENTITY_BATCH_SIZE = 100;
const CREATE_BATCH_SIZE = 2000;
const UPDATE_BATCH_SIZE = 2000;
const DELETE_BATCH_SIZE = 30;

/**
 * Validate an input against a given schema.
 * @param schema Schema to validate input against.
 * @param input Input to be validated.
 * @returns {Promise<*>} Input with cast values from schema.
 */
export async function validate(schema, input) {
    try {
        await schema.validate(input);
        return schema.cast(input)
    } catch (error) {
        throw new Error(error.message);
    }
}

// Properties
const LIMIT_PROPERTY = {
    limit: yup.number()
        .nullable()
        .notRequired()
        .default(0)
};

const getBatchProp = (defaultSize) => {
    return {
        batchSize: yup.number()
            .notRequired()
            .nullable()
            .default(defaultSize)
    }
};

const getReturnResultProp = (defaultVal) => {
    return {
        returnResult: yup.boolean()
            .default(defaultVal)
    }
}

// Shared Objects
const PERFORM_OP_IN_BATCH_ObJ = {
    ...getBatchProp(100),
    ...getReturnResultProp(false),
    progress: yup.boolean()
        .nullable()
        .notRequired()
        .default(false),
    batchDelay: yup.number()
        .notRequired()
        .nullable()
        .default(0),
    parallel: yup.number()
        .default(1),
    parallelDelay: yup.number()
        .notRequired()
        .nullable()
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
    ...getReturnResultProp(false)
});

const PROGRESS_SCHEMA = yup.object({
    enabled: yup.boolean()
        .nullable()
        .notRequired()
        .default(false),
    instance: yup.object()
        .nullable()
        .notRequired()
        .when("enabled", {
            is: true,
            then: (schema) => schema.default(
                new cliProgress.MultiBar({
                    clearOnComplete: false,
                    hideCursor: true
                }, cliProgress.Presets.shades_classic)
            ),
            otherwise: (schema) => schema.default(null)
        }),
    increment: yup.string()
        .nullable()
        .notRequired()
        .when("enabled", {
            is: true,
            then: (schema) => schema.default("increment"),
            otherwise: (schema) => schema.default(null)
        }),
    create: yup.string()
        .nullable()
        .notRequired()
        .when("enabled", {
            is: true,
            then: (schema) => schema.default("create"),
            otherwise: (schema) => schema.default(null)
        })
});

const CLIENT_SCHEMA = yup.object({
    impersonateAs: yup.string()
        .nullable()
        .notRequired()
        .default(null),
    acceptGzip: yup.boolean()
        .nullable()
        .notRequired()
        .default(false),
    progress: PROGRESS_SCHEMA,
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
    CLIENT_SCHEMA
}