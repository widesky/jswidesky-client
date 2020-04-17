/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for MARKER singleton
 */
"use strict";

const MARKER = require('../../src/data').MARKER,
    expect = require('chai').expect;


describe('data', () => {
    describe('MARKER', () => {
        describe('.toHSJSON', () => {
            it('should emit JSON', () => {
                expect(MARKER.toHSJSON()).to.equal('m:');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC', () => {
                expect(MARKER.toHSZINC()).to.equal('M');
            });
        });
    });
});
