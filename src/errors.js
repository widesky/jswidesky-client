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
            if (lodash.has(data, "meta.dis")) {
                return new HaystackError(data.meta.dis.substring(2), reqError);
            }
            else if (data.errors !== undefined && Array.isArray(data.errors) && data.errors.length > 0) {
                let errMsg = "More than 1 GraphQLError encountered";
                if (data.errors.length === 1) {
                    errMsg = data.errors[0].message;
                }

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
    constructor(name, reqError) {
        super(name, reqError);
    }
}

/**
 * GraphQL type error due to syntax issues
 */
class GraphQLError extends RequestError {
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