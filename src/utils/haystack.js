const { validate: uuidValidate } = require("uuid");

/**
 * Remove the Haystack prefix if applied.
 * @param value Value with/without Haystack prefix.
 * @returns {String|string} Value without Haystack prefix.
 */
function removePrefix(value) {
    if (typeof value !== 'string' && !(value instanceof String)) {
        throw new Error("Value is not of type String");
    }

    if (value[1] === ":") {
        return value.substring(2);
    }

    return value;
}

/**
 * Get the id of the entity or id like value from a reference tag.
 * @param entity Entity to be searched.
 * @param tag Tag of the entity for which you'd like a id like value from.
 * @returns {*|string} A UUID of the entity of
 */
function getId(entity, tag=null) {
    let id;
    if (tag) {
        if (entity[tag] === undefined) {
            throw new Error(`Entity does not have tag ${tag}`);
        }
        else if (entity[tag].substring(0, 2) !== "r:") {
            throw new Error(`Entity tag ${tag} is not a reference tag`);
        }

        id = removePrefix(entity[tag]);
    }
    else {
        if (entity.id === undefined) {
            throw new Error("No id present on the entity");
        }

        id = removePrefix(entity.id);
    }

    if (id.includes(" ")) {
        // only applicable if dis tag is specified on entity
        return id.substring(0, id.indexOf(" "));
    } else {
        return id;
    }
}

/**
 * Get a human-readable identification of the entity if possible.
 * @param entity Entity to be checked.
 * @returns {*|String|string} fqname or id of entity.
 */
function getReadableName(entity) {
    if (entity.fqname !== undefined) {
        return removePrefix(entity.fqname);
    } else {
        return getId(entity);
    }
}

/**
 * Convert a given value to its Haystack prefix using the given kind.
 * @param value Value to be assigned its prefix.
 * @param kind Haystack kind of the value.
 * @returns {(string|*)[]|string} Value with Haystack prefix assigned.
 */
function toHaystack(value, kind) {
    switch (kind) {
        case "Str":
            return `s:${value}`;
        case "Ref":
            return `r:${value}`;
        case "Number":
            return `n:${value}`;
        case "Marker":
            return "m:";
        case "Coord":
            return `c:${value}`;
        case "Time":
            return `h:${value}`;
        case "Date":
            return `d:${value}`;
        case "DateTime":
            return `t:${value}`;
        case "Zero":
            return "z:";
        case "Bool":
            return `${value}`;
        case "Uri":
            return `u:${value}`;
        case "List":
            return value.substring(1, value.length - 1)
                .split(",")
                .map((val) => val.trim())
                .map((val) => uuidValidate(val) ?
                    toHaystack(val, "Ref") : toHaystack(val, "Str"));
        default:
            throw new Error(`Unknown kind ${kind} for value ${value}`);
    }
}

module.exports = {
    removePrefix,
    getReadableName,
    getId,
    toHaystack
}