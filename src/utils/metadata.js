'use strict';

/**
 * Parse and merge metadata (object or JSON string) into the unified object.
 *
 * @param {Object|string} [metadata] - Metadata to parse.
 * @returns {object | undefined} The merged metadata.
 */
function parseMetadata(metadata) {
    if (metadata === undefined) {
        return;
    }

    // If metadata is a string, attempt JSON parsing
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata);
        } catch (err) {
            throw new Error(`Invalid metadata string; must be valid JSON. Received: ${metadata}`);
        }
    }

    if (typeof metadata === 'object' && metadata !== null) {
        return metadata;
    } else {
        throw new Error('Metadata must be an object or JSON string.');
    }
}

module.exports = {
    parseMetadata,
};
