const lodash = require("lodash");
const { Logger } = require("bunyan")

/**
 * Error class to capture different types of request errors
 */
class RequestError extends Error {
    requestError;       // Initial Axios error
    status;             // Request status code

    /**
     * Constructor for RequestError
     * @param {string} name Name of error.
     * @param {AxiosError} reqError Request error to be used.
     */
    constructor(name, reqError) {
        super(name);
        // extend stack trace to not lose the existing trace
        this.requestError = reqError;
        this.status = reqError.status;
        this.stack += reqError.stack.substring(reqError.stack.indexOf("\n"));
    }

    /**
     * Make a HaystackError, GraphQLError where applicable. If the given reqError is not determined to be either a
     * HaystackError or GraphQL error, the original error is returned.
     * @param {AxiosError | Error} reqError Error to be parsed.
     * @param {Logger} logger A Bunyan logging instance to log the creation of a new Error instance.
     */
    static make(reqError, logger) {
        if (lodash.has(reqError, "response.data")) {
            const { data } = reqError.response;
            if (lodash.has(data, "meta.dis")) {
                return new HaystackError(data.meta.dis.substring(2), reqError);
            }
            else if (data.errors !== undefined && Array.isArray(data.errors) && data.errors.length > 0) {
                let errMsg = "More than 1 GraphQLError encountered";
                if (data.errors.length === 1) {
                    errMsg = data.errors[0].message;
                }

                logger.debug("Raw GraphQL error response: %j", data);
                return new GraphQLError(errMsg.replace(/\n/g, ""), reqError);
            }
            else {
                // Neither a valid Haystack of GraphQL error
                return reqError;
            }
        }
        else {
            return reqError;
        }
    }
}

/**
 * Haystack type error (e.g. HisWrite, CreateRec, HisRead, etc.)
 */
class HaystackError extends RequestError {

    /**
     * Constructor for HaystackError
     * @param {string} name Name of error.
     * @param {AxiosError} reqError Request error to be used.
     */
    constructor(name, reqError) {
        super(name, reqError);
    }
}

/**
 * GraphQL type error due to syntax issues
 */
class GraphQLError extends RequestError {

    /**
     * Constructor for GraphQLError
     * @param {string} name Name of error.
     * @param {AxiosError} reqError Request error to be used.
     */
    constructor(name, reqError) {
        super(name.replace(/\n/g, ""), reqError);
        this.errors = [];
        for (const errorMsg of reqError.response.data.errors) {
            const {message, locations} = errorMsg;
            const locationsStr = locations.map((loc) => `line ${loc.line}:${loc.column}`);
            this.errors.push(`${message.replace(/\n/g, " ")} @ location/s ${locationsStr.join(", ")}`);
        }
    }
}

module.exports = {
    RequestError,
    HaystackError,
    GraphQLError
}