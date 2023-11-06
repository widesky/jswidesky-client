/**
 * Perform a find operation but return the rows attribute of the response from API server.
 * @param filter Haystack filter to search for entities.
 * @param limit Maximum number of entities to be returned.
 * @returns {Promise<*>}
 */
const find = async (filter, limit=0) => {
    return (await this.find(filter, limit)).rows;
}

module.exports = {
    find
}