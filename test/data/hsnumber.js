/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for HSNumber class
 * (C) 2018 VRT Systems
 */
"use strict";

const HSNumber = require('../../src/data').HSNumber,
    expect = require('chai').expect;


describe('data', () => {
    describe('HSNumber', () => {
        const numWithoutUnit = new HSNumber(56342.321),
            numWithUnit = new HSNumber(56342.321, 'kWh');

        describe('constructor', () => {
            it('should clone a HSNumber-like object', () => {
                let n = new HSNumber({value: 425.243, unit:'V'});
                expect(n.value).to.equal(425.243);
                expect(n.unit).to.equal('V');
            });

            it('should not clone a HSNumber-like object with '
                + 'non-numeric value', () => {
                    try {
                        let n = new HSNumber({value: '425.243', unit:'V'});
                        throw new Error('Constructor should have failed');
                    } catch (err) {
                        if (err.message !==
                                'clonee \'value\' property must be a number')
                            throw err;
                    }
                });

            it('should not clone a HSNumber-like object with '
                + 'non-string unit', () => {
                    try {
                        let n = new HSNumber({value: 425.243, unit:123123});
                        throw new Error('Constructor should have failed');
                    } catch (err) {
                        if (err.message !==
                                ('clonee \'unit\' property must be a string '
                                    + 'or undefined'))
                            throw err;
                    }
                });

            it('should cast a bare number as a HSNumber', () => {
                let n = new HSNumber(14325.456);
                expect(n.value).to.equal(14325.456);
                expect(n.unit).to.be.undefined;
            });

            it('should parse a JSON number without unit', () => {
                let n = new HSNumber('n:123.45');
                expect(n.value).to.equal(123.45);
                expect(n.unit).to.be.undefined;
            });

            it('should parse a JSON integer', () => {
                let n = new HSNumber('n:1235');
                expect(n.value).to.equal(1235);
                expect(n.unit).to.be.undefined;
            });

            it('should parse a JSON number with unit', () => {
                let n = new HSNumber('n:4562.5 kWh');
                expect(n.value).to.equal(4562.5);
                expect(n.unit).to.equal('kWh');
            });

            it('should parse a ZINC number without unit', () => {
                let n = new HSNumber('123.45');
                expect(n.unit).to.be.undefined;
                expect(n.value).to.equal(123.45);
            });

            it('should parse a ZINC integer', () => {
                let n = new HSNumber('1235');
                expect(n.unit).to.be.undefined;
                expect(n.value).to.equal(1235);
            });

            it('should parse a ZINC number with unit', () => {
                let n = new HSNumber('4562.5kWh');
                expect(n.unit).to.equal('kWh');
                expect(n.value).to.equal(4562.5);
            });
        });

        describe('.toHSJSON', () => {
            it('(without unit) should emit JSON string', () => {
                expect(numWithoutUnit.toHSJSON()).to.equal('n:56342.321');
            });
            it('(with unit) should emit JSON string', () => {
                expect(numWithUnit.toHSJSON()).to.equal('n:56342.321 kWh');
            });
        });

        describe('.toHSZINC', () => {
            it('(without unit) should emit ZINC string', () => {
                expect(numWithoutUnit.toHSZINC()).to.equal('56342.321');
            });
            it('(with unit) should emit ZINC string', () => {
                expect(numWithUnit.toHSZINC()).to.equal('56342.321kWh');
            });
        });
    });
});
