// vim: set tw=78 et sw=4 ts=4 sts=4:
const _ = require('lodash');
const Find = require('../../src/graphql/find');
const chai = require("chai");
const expect = chai.expect;

const TEST_QUERY_RESPONSE =
    `{
  "data": {
    "haystack": {
      "search": {
        "elecPoint": [],
        "waterPoint": [
          {
            "id": "0047e76c-fe51-11ea-aa93-0242ac120004",
            "history": {
              "timeSeries": [
                {
                  "dataPoints": [
                    {
                      "time": 1601560800000,
                      "value": "0.417"
                    },
                    {
                      "time": 1601560860000,
                      "value": "0.501"
                    }
                  ]
                }
              ]
            }
          }
        ]
      }
    }
  }
}`;

const TEST_PART_OF_QUERY_RESPONSE =
    `{
       "timeSeries": [
         {
           "dataPoints": [
             {
               "time": 1601560800000,
               "value": "0.417"
             },
             {
               "time": 1601560860000,
               "value": "0.501"
             }
           ]
         }
       ]
     }`;

describe('Find', () => {
    describe('timeseriesNode', () => {
        describe('and aliasName exists', () => {
            it('should return the path to the timeseries node', () => {
                const found = Find.timeseriesNode("waterPoint", TEST_QUERY_RESPONSE);
                expect(found.path).to.equal(
                    "data.haystack.search.waterPoint[0].history.timeSeries");
            });

            it('should return the timeSeries object', () => {
                const found = Find.timeseriesNode("waterPoint", TEST_QUERY_RESPONSE);
                expect(_.isObject(found.target)).to.equal(true);
                expect(_.has(found.target, 'timeSeries')).to.equal(true);
            });
        });

        describe('and aliasName dont exists', () => {
            it('should return null', () => {
                const found = Find.timeseriesNode("solarPoint", TEST_QUERY_RESPONSE);
                expect(found.target).to.equal(null);
            });

            it('should return empty path', () => {
                const found = Find.timeseriesNode("solarPoint", TEST_QUERY_RESPONSE);
                expect(found.path).to.equal('');
            });
        });
    });

    describe('node', () => {
        describe('and nodeName exists', () => {
            it('should return the path to the desire node', () => {
                const found = Find.node("dataPoints",
                    JSON.parse(TEST_PART_OF_QUERY_RESPONSE),
                    true);
                expect(found.path).to.equal(
                    "timeSeries[0].dataPoints");
            });

            it('should return the dataPoints object', () => {
                const found = Find.node("dataPoints",
                    JSON.parse(TEST_PART_OF_QUERY_RESPONSE),
                    true);
                expect(_.isObject(found.target)).to.equal(true);
                expect(_.has(found.target, 'dataPoints')).to.equal(true);
            });
        });

        describe('and nodename dont exists', () => {
            it('should return null', () => {
                const found = Find.timeseriesNode("name", JSON.parse(TEST_QUERY_RESPONSE));
                expect(found.target).to.equal(null);
            });

            it('should return empty path', () => {
                const found = Find.timeseriesNode("id", TEST_QUERY_RESPONSE);
                expect(found.path).to.equal('');
            });
        });
    });
});
