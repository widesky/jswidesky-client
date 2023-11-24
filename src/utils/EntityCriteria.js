class EntityCriteria {

    /**
     * EntityCriteria class constructor
     * @param name Name of criteria
     * @param conditionalFunc A function to determine if a given entity is applicable for the criteria.
     *                        Takes 1 argument as the entity. Returns true or false.
     * @param resultFunc A function to apply change to the entity if determined to be applicable.
     *                   Takes 2 arguments. Returns nothing.:
     *                    - entity: The update payload to be pushed, with the id property filled
     *                    - oldEntity: The entity to be updated. Can be used as a reference to make changes.
     */
    constructor(name, conditionalFunc, resultFunc) {
        this.name = name;
        this.conditionalFunc = conditionalFunc;
        this.resultFunc = resultFunc;
    }

    /**
     * Determines if the entity is valid for this criteria.
     * @param entity Entity to be checked.
     * @returns {*} Return true or false.
     */
    isValid(entity) {
        return this.conditionalFunc(entity);
    }

    /**
     * Applies the changes to be made to the entity.
     * @param entity Updates to be applied to the entity for an update payload to WideSky.
     * @param oldEntity The old entity to make update references from.
     */
    applyChanges(entity, oldEntity) {
        this.resultFunc(entity, oldEntity);
    }
}

module.exports = EntityCriteria;