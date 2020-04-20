/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for NA singleton
 */
"use strict";

const NA = require('../../src/data').NA,
    expect = require('chai').expect;


describe('data', () => {
    describe('NA', () => {
        describe('.toHSJSON', () => {
            it('should emit JSON', () => {
                expect(NA.toHSJSON()).to.equal('z:');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC', () => {
                expect(NA.toHSZINC()).to.equal('NA');
            });
        });
    });
});
