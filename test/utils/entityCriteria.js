/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const sinon = require('sinon');
const EntityCriteria = require("../../src/utils/EntityCriteria");
const expect = require('chai').expect;

const TEST_ENTITY = {
    "alarm": "m:",
    "alarmOf": "r:9e9909c3-406b-4c79-b4b3-8b218e2ede3e testAlarmPoint",
    "dis": "s:Meters No Data",
    "edgeNodeId": "s:a0a3c169.d0842",
    "equipRef": "r:05d5c114-e883-4995-b8a5-e44c02aeb876 testAlarmEquip",
    "fqname": "s:american_axle.testAlarmEquip.no_data_meter",
    "his": "m:",
    "id": "r:37a49ab0-1df9-11ed-a1ef-d915cda075bd Meters No Data",
    "kind": "s:Number",
    "lastHisTime": "t:2022-08-17T06:50:00Z",
    "lastHisVal": "n:128",
    "name": "s:no_data_meter",
    "point": "m:",
    "siteRef": "r:a6817d5b-c258-4718-b4c2-bcd370159e0a American Axle & Manufacturing Holdings, Inc., Detroit, Michigan, United States",
    "tz": "s:GMT-10"
};

describe("EntityCriteria", () => {
    describe("isValid", () => {
        it("should return true", () => {
            const criteria = new EntityCriteria(
                "test",
                (entity) => entity.tz !== undefined,
                () => {}
            );
            expect(criteria.isValid(TEST_ENTITY)).to.be.true;
        });

        it("should return false", () => {
            const criteria = new EntityCriteria(
                "test",
                (entity) => entity.tzz !== undefined,
                () => {}
            );
            expect(criteria.isValid(TEST_ENTITY)).to.be.false;
        });
    });

    describe("applyChanges", () => {
        it("should apply changes to entity", () => {
            const criteria = new EntityCriteria(
                "test",
                (entity) => entity.tzz !== undefined,
                (entity, oldEntity) => {
                    entity.test = "test";
                }
            );
            const entity = {};
            criteria.applyChanges(entity, TEST_ENTITY);
            expect(entity).to.eql({
                test: "test"
            });
        });

        it("should apply changes based on old entity", () => {
            const criteria = new EntityCriteria(
                "test",
                (entity) => entity.tzz !== undefined,
                (entity, oldEntity) => {
                    entity.test = oldEntity.tz;
                }
            );
            const entity = {};
            criteria.applyChanges(entity, TEST_ENTITY);
            expect(entity).to.eql({
                test: TEST_ENTITY.tz
            });
        });
    });
});