// vim: set tw=78 et sw=4 ts=4 sts=4:
const Replace = require('../../src/graphql/replace');
const chai = require("chai");
const expect = chai.expect;
const assert = chai.assert;

const TEST_QUERY =
`{
  widesky: haystack {
    history(rangeAbsolute: {start: "$from", end: "$to"}) {
      timeSeries {
        dataPoints {
          time
          value
        }
      }
    }
  }
}`;

const TEST_QUERY_2 =
    `{
  haystack {
    search(filter: "point and water and spaceRef==@$\{spaceId\}", limit: 1) {
      waterPoint: entity {
        id
      }
    }
  }
}
`;

describe('Replace', () => {
    describe('outerBraces', () => {
        it('should wrap query in braces if not present', () => {
            expect(
                Replace.outerBraces(
                    ' a query without braces '
                )
            ).to.equal(
                '{  a query without braces  }'
            );
        });

        it('should ignore inner braces', () => {
            expect(
                Replace.outerBraces(
                    ' a query { without } outer braces '
                )
            ).to.equal(
                '{  a query { without } outer braces  }'
            );
        });

        it('should leave query with outer braces as-is', () => {
            expect(
                Replace.outerBraces(
                    '  {a query with outer braces}  '
                )
            ).to.equal(
                '  {a query with outer braces}  '
            );
        });
    });

    describe('filterVar', () => {
        describe('varname=spaceId', () => {
            it ('should replace the variable', () => {
                expect(Replace.filterVar(TEST_QUERY_2, "spaceId", "12345"))
                    .to.equal(
`{
  haystack {
    search(filter: "point and water and spaceRef==@12345", limit: 1) {
      waterPoint: entity {
        id
      }
    }
  }
}
`
                );
            });
        });

        describe('varname=${spaceId}', () => {
            it ('should replace the variable', () => {
                expect(Replace.filterVar(TEST_QUERY_2, "spaceId", "12345"))
                    .to.equal(
`{
  haystack {
    search(filter: "point and water and spaceRef==@12345", limit: 1) {
      waterPoint: entity {
        id
      }
    }
  }
}
`);
            });
        });
    })

    describe('time variables', () => {
        describe("rangeFrom=12345", () => {
            it('should replace the $from variable', () => {
                expect(Replace.timeVars(
                    TEST_QUERY,
                    "12345")).to.be.equal(
`{
  widesky: haystack {
    history(rangeAbsolute: {start: "12345", end: "$to"}) {
      timeSeries {
        dataPoints {
          time
          value
        }
      }
    }
  }
}`);
            });
        });

        describe("rangeTo=67890", () => {
            it('should replace the $to variable', () => {
                expect(Replace.timeVars(
                    TEST_QUERY,
                    null,
                    "67890")).to.be.equal(
`{
  widesky: haystack {
    history(rangeAbsolute: {start: "$from", end: "67890"}) {
      timeSeries {
        dataPoints {
          time
          value
        }
      }
    }
  }
}`);
            });
        });

        describe("rangeFrom=abc and rangeTo=def", () => {
            it('should replace both $from and $to variables', () => {
                expect(Replace.timeVars(
                    TEST_QUERY,
                    "abc",
                    "def")).to.be.equal(
`{
  widesky: haystack {
    history(rangeAbsolute: {start: "abc", end: "def"}) {
      timeSeries {
        dataPoints {
          time
          value
        }
      }
    }
  }
}`);
            });
        });
    });
});
