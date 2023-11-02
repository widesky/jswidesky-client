const lodash = require("lodash");

/**
 * Error class to capture different types of request errors
 */
class RequestError extends Error {
    constructor(name, reqError) {
        super(name);
        // extend stack trace to not lose the existing trace
        this.stack += reqError.stack.substring(reqError.stack.indexOf("\n"));
    }

    static make(reqError) {
        if (lodash.has(reqError, "response.data")) {
            const { data } = reqError.response;
            if (data.meta) {
                return new HaystackError(reqError.response.data.meta.dis.substring(2), reqError);
            } else {
                let errMsg = "More than 1 error encountered";
                if (data.errors.length === 1) {
                    errMsg = data.errors[0].message;
                }

                return new GraphQLError(errMsg.replace(/\n/g, ""), reqError);
            }
        } else {
            return reqError;
        }
    }
}

/**
 * Haystack type error (e.g. HisWrite, CreateRec, HisRead, etc.)
 */
class HaystackError extends RequestError {
    constructor(name, reqError) {
        super(name, reqError);
    }
}

/**
 * GraphQL type error due to syntax issues
 */
class GraphQLError extends RequestError {
    constructor(name, reqError) {
        super(name, reqError);
        this.errors = reqError.response.data.errors;
    }
}

module.exports = {
    RequestError,
    HaystackError,
    GraphQLError
}