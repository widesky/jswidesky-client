/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for REMOVE singleton
 */
"use strict";

const {
    REMOVE,
    VER_3
} = require('../../src/data'),
    expect = require('chai').expect;


describe('data', () => {
    describe('REMOVE', () => {
        describe('.toHSJSON', () => {
            it('should emit JSON (v2)', () => {
                expect(REMOVE.toHSJSON()).to.equal('x:');
            });
            it('should emit JSON (v3)', () => {
                expect(REMOVE.toHSJSON(VER_3)).to.equal('-:');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC', () => {
                expect(REMOVE.toHSZINC()).to.equal('R');
            });
        });
    });
});
