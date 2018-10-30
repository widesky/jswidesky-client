/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for String class
 * (C) 2018 VRT Systems
 */
"use strict";

const String = require('../../src/data').String,
    expect = require('chai').expect;


describe('data', () => {
    describe('String', () => {
        describe('fromHS', () => {
            it('should parse a JSON string', () => {
                expect(String.fromHS('s:this is a test "string"')).to.equal(
                    'this is a test "string"'
                );
            });

            it('should parse a ZINC string', () => {
                expect(String.fromHS('"this is a test \\"string\\""')).to.equal(
                    'this is a test "string"'
                );
            });

            it('should pass through raw strings', () => {
                expect(String.fromHS('a raw string')).to.equal('a raw string');
            });
        });

        describe('.toHSJSON', () => {
            it('should emit JSON string', () => {
                /* We should be able to do this with the native string type */
                expect(('my "string"').toHSJSON()).to.equal('s:my "string"');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC string', () => {
                /* We should be able to do this with the native string type */
                expect(('my "string"').toHSZINC()).to.equal('"my \\"string\\""');
            });
        });
    });
});
