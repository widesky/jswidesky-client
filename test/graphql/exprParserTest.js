// vim: set sw=4 ts=4 sts=4 tw=78 et:
const moment = require('moment-timezone');
const proxyquire = require('proxyquire');

moment.suppressDeprecationWarnings = true;

/* Module under test */
const ExprParser = proxyquire(
    '../../src/graphql/exprParser',
    {
        /* Wrap "moment" so it injects a hard-coded time */
        'moment-timezone': (...args) => {
            if (args.length === 0)
                return moment("2010-02-15 10:01:05+10:00");
            else
                return moment(...args);
        }
    }
);

const chai = require("chai");
const expect = chai.expect;

describe('ExprParser dateTime expression', () => {

    describe('parseDt', () => {
        describe('expr=n0w', () => {
            it('should throw error', () => {
                expect(() => ExprParser.parseDt(
                    'n0w',
                    'Australia/Brisbane')).to.throw();
            });
        });

        describe('expr=2010-02-15 10:01:05+10:00', () => {
            it('should parse a moment dateTime', () => {
                expect(ExprParser.parseDt(
                    '2010-02-15 10:01:05+10:00',
                    'Australia/Brisbane')).to.be.equal("2010-02-15T00:01:05.000Z");
            });
        });
    });

    describe('asWideskyDT', () => {
        describe('expr=now', () => {
            it('should return the current epoch', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T00:01:05.000Z");
            });
        });

        // addition
        describe('expr=now + 1d', () => {
            it('should return epoch of next day', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now + 1d',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-16T00:01:05.000Z");
            });
        });

        describe('expr=now+ 5h', () => {
            it('should return 5h to the future', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now+ 5h',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T05:01:05.000Z");
            });
        });

        describe('expr=now+ 5m', () => {
            it('should return 5m to the future', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now+ 5m',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T00:06:05.000Z");
            });
        });

        describe('expr=now+ 1s', () => {
            it('should return 1s to the future', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now +1s',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T00:01:06.000Z");
            });
        });

        describe('expr=now + 1M', () => {
            it('should return 1 month to the future', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now + 1M',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-03-15T00:01:05.000Z");
            });
        });

        describe('expr=now+1d/d', () => {
            it('should return start of next day', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now+1d/d',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T14:00:00.000Z");
            });
        });

        describe('expr=now+5m/m', () => {
            it('should return start of 5min to the future', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now+5m/m',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T00:06:00.000Z");
            });
        });

        describe('expr=now+5M/M', () => {
            it('should return start of 5months to the future', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now+5M/M',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-06-30T14:00:00.000Z");
            });
        });

        describe('expr=now +', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now + ',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now + .\n'
                        + 'Expecting numbers followed by the + sign.'
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now + 5', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now + 5',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now + 5.\n'
                        + 'Missing unit after \'+5\''
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now + 5Y', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now + 5Y',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now + 5Y.\n'
                        + 'Missing unit after \'+5\''
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now + 5M/M3', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now + 5M/M3',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now + 5M/M3.\n'
                        + 'Unexpected value found after /M.'
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now + 5M 3', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now + 5M 3',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    /* WC-2863 TODO: don't agree with this message */
                    if (err.message !== (
                        'Invalid datetime expression now + 5M 3.\n'
                        + 'Expecting a datetime unit after the \'/\' char.'
                    ))
                        throw err;
                }
            });
        });

        // subtract
        describe('expr=now - 100d', () => {
            it('should return epoch of 100 days before', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now - 100d',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2009-11-07T00:01:05.000Z");
            });
        });

        describe('expr=now-5m', () => {
            it('should return 5m earlier', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now-5m',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-14T23:56:05.000Z");
            });
        });

        describe('expr=now- 1s', () => {
            it('should return 1s earlier', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now -1s',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-15T00:01:04.000Z");
            });
        });

        describe('expr=now - 12M', () => {
            it('should return 1 month earlier', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now - 12M',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2009-02-15T00:01:05.000Z");
            });
        });

        describe('expr=now-1d/d', () => {
            it('should return start of yesterday', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now-1d/d',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-13T14:00:00.000Z");
            });
        });

        describe('expr=now-50m/m', () => {
            it('should return start of 5min earlier', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now-50m/m',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-14T23:11:00.000Z");
            });
        });

        describe('expr=now-2M/M', () => {
            it('should return start of 5months earlier', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now-2M/M',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2009-11-30T14:00:00.000Z");
            });
        });

        describe('expr=now -', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now - ',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now - .\n'
                        + 'Expecting numbers followed by the - sign.'
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now - 5', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now - 5',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now - 5.\n'
                        + 'Missing unit after \'-5\''
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now - 5Y', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now - 5Y',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now - 5Y.\n'
                        + 'Missing unit after \'-5\''
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now - 5M/M3', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now - 5M/M3',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    if (err.message !== (
                        'Invalid datetime expression now - 5M/M3.\n'
                        + 'Unexpected value found after /M.'
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now - 5M 3', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now - 5M 3',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    /* WC-2863 TODO: don't agree with this message */
                    if (err.message !== (
                        'Invalid datetime expression now - 5M 3.\n'
                        + 'Expecting a datetime unit after the \'/\' char.'
                    ))
                        throw err;
                }
            });
        });

        describe('expr=now/d', () => {
            it('should return the start of the day', () => {
                let epoch = ExprParser.asWideskyDT(
                    'now/d',
                    'Australia/Brisbane');
                expect(epoch).to.be.equal("2010-02-14T14:00:00.000Z");
            });
        });

        // misc unhappy paths
        describe('expr=now % 2M', () => {
            it('should throw error', () => {
                try {
                    ExprParser.asWideskyDT(
                        'now % 2M',
                        'Australia/Brisbane');
                    throw new Error('Should not have worked');
                } catch (err) {
                    /* WC-2863 TODO: don't agree with this message */
                    if (err.message !== (
                        'Invalid datetime expression now % 2M.\n'
                        + 'Expecting \'+\',\'-\' or \'/\' sign after now.'
                    ))
                        throw err;
                }
            });
        });
    });

    describe('toMomentUnit', () => {
        it('should recognise \'m\' as minutes', () => {
            expect(ExprParser.toMomentUnit('m')).to.equal('minutes');
        });

        it('should recognise \'s\' as seconds', () => {
            expect(ExprParser.toMomentUnit('s')).to.equal('seconds');
        });

        it('should recognise \'d\' as days', () => {
            expect(ExprParser.toMomentUnit('d')).to.equal('days');
        });

        it('should recognise \'h\' as hours', () => {
            expect(ExprParser.toMomentUnit('h')).to.equal('hours');
        });

        it('should recognise \'M\' as months', () => {
            expect(ExprParser.toMomentUnit('M')).to.equal('months');
        });

        it('should return undefined for unknown units', () => {
            expect(ExprParser.toMomentUnit('Y')).to.be.undefined;
        });
    });

    describe('toMsEpoch', () => {
        it('should convert ISO-8601 to JavaScript epoch time', () => {
            expect(
                ExprParser.toMsEpoch('2020-04-30T13:26:20+10:00')
            ).to.equal(
                1588217180000
            );
        });
    });
});
