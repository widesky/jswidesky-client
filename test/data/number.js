/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for Number class
 */
"use strict";

const HSNumber = require('../../src/data').HSNumber,
    expect = require('chai').expect;


describe('data', () => {
    describe('Number', () => {
        describe('.fromHS', () => {
            it('should pass through to HSNumber constructor', () => {
                /*
                 * This will be difficult to prove, but at least we should
                 * see a HSNumber come out!
                 */
                expect(Number.fromHS('2345.534')).to.be.instanceof(HSNumber);
            });
        });

        describe('.toHSNumber', () => {
            it('should convert bare number to HSNumber', () => {
                const n = 123456;
                let hsn = n.toHSNumber();

                expect(hsn).to.be.instanceof(HSNumber);
                expect(hsn.value).to.equal(n);
                expect(hsn.unit).to.be.undefined;
            });

            it('should convert bare number and unit to HSNumber', () => {
                const n = 123456;
                let hsn = n.toHSNumber('Wh');

                expect(hsn).to.be.instanceof(HSNumber);
                expect(hsn.value).to.equal(n);
                expect(hsn.unit).to.equal('Wh');
            });
        });

        describe('.toHSJSON', () => {
            it('should emit JSON string', () => {
                expect((3472).toHSJSON()).to.equal('n:3472');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC string', () => {
                expect((3472).toHSZINC()).to.equal('3472');
            });
        });
    });
});
