/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for Date class
 * (C) 2018 VRT Systems
 */
"use strict";

const Date = require('../../src/data').Date,
    expect = require('chai').expect;


describe('data', () => {
    describe('Date', () => {
        const dateObj = new Date('2018-10-30T12:23:47+10:00');

        describe('fromHS', () => {
            it('should parse a JSON datetime', () => {
                let d = Date.fromHS('t:2018-10-30T12:23:47+10:00 Brisbane');
                expect(d).to.be.instanceof(Date);
                expect(d.valueOf()).to.equal(dateObj.valueOf());
            });

            it('should parse a ZINC datetime', () => {
                let d = Date.fromHS('2018-10-30T12:23:47+10:00 Brisbane');
                expect(d).to.be.instanceof(Date);
                expect(d.valueOf()).to.equal(dateObj.valueOf());
            });

            it('should parse a datetime without timezone', () => {
                let d = Date.fromHS('2018-10-30T02:23:47Z');
                expect(d).to.be.instanceof(Date);
                expect(d.valueOf()).to.equal(dateObj.valueOf());
            });
        });

        describe('.toHSJSON', () => {
            it('should emit JSON string', () => {
                /* We should be able to do this with the native date type */
                expect(dateObj.toHSJSON()).to.equal('t:2018-10-30T02:23:47.000Z UTC');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC string', () => {
                /* We should be able to do this with the native date type */
                expect(dateObj.toHSZINC()).to.equal('2018-10-30T02:23:47.000Z UTC');
            });
        });
    });
});
