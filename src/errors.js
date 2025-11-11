const lodash = require("lodash");
/**
 * @typedef {import('bunyan')} Logger
 */

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
     * @param {Logger | Console} logger A Bunyan or console logging instance to log the creation of
     *                                  a new Error instance.
     */
    static make(reqError, logger) {
        // Returning early: HTTP error received but response has no data.
        // Cannot determine if it's a HaystackError or GraphQLError, so return the original error.
        if (!lodash.has(reqError, "response.data")) {
            return reqError;
        }
        
        // Returning early because data is undefined or null.
        // Cannot determine error type (GraphQLError or HaystackError).
        const { data } = reqError.response;
        if (data == undefined || data === null) {
            return reqError;
        }
        // If response contains a Haystack error signature, construct a HaystackError.
        else if (lodash.has(data, "meta.dis")) {
            return new HaystackError(data.meta.dis.substring(2), reqError);
        }
        // If response contains GraphQL-style errors, construct a GraphQLError.
        else if (data.errors !== undefined && Array.isArray(data.errors) && data.errors.length > 0) {
            let errMsg = "More than 1 GraphQLError encountered";
            if (data.errors.length === 1) {
                errMsg = data.errors[0].message;
            }

            logger.debug("Raw GraphQL error response: %j", data);
            return new GraphQLError(errMsg.replace(/\n/g, ""), reqError);
        }
        else {
            // Returning early because can't determine error type (not Haystack or GraphQL).
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