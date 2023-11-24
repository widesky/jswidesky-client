/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for parse routines
 */
"use strict";

const {
    parse,
    MARKER,
    NA,
    REMOVE,
    HSNumber,
    Ref,
    Date
}= require('../../src/data'),
    expect = require('chai').expect;


describe('data', () => {
    describe('parse', () => {
        describe('simple types', () => {
            it('should return false as-is', () => {
                expect(parse(false)).to.be.false;
            });
            it('should return true as-is', () => {
                expect(parse(true)).to.be.true;
            });
            it('should return null as-is', () => {
                expect(parse(null)).to.be.null;
            });
            it('should return undefined as null', () => {
                expect(parse(undefined)).to.be.null;
            });
        });

        describe('string-encoded types', () => {
            it('should decode "m:" as MARKER', () => {
                expect(parse("m:")).to.equal(MARKER);
            });

            it('should decode "z:" as NA', () => {
                expect(parse("z:")).to.equal(NA);
            });

            it('should decode "x:" as REMOVE', () => {
                expect(parse("x:")).to.equal(REMOVE);
            });

            it('should decode "-:" as REMOVE', () => {
                expect(parse("-:")).to.equal(REMOVE);
            });

            it('should decode "n:XXX" as a number', () => {
                let res = parse('n:123 Hz');
                expect(res).to.be.instanceof(HSNumber);
                expect(res.value).to.equal(123);
                expect(res.unit).to.equal('Hz');
            });

            it('should decode "r:XXX" as a Ref', () => {
                let res = parse('r:XXX');
                expect(res).to.be.instanceof(Ref);
                expect(res.id).to.equal('XXX');
            });

            it('should decode "s:XXX" as a string', () => {
                expect(parse("s:XXX")).to.equal('XXX');
            });

            it('should decode "t:XXX" as a Date', () => {
                let res = parse('t:2020-04-08T18:58+10:00 Brisbane');
                expect(res).to.be.instanceof(Date);
                expect(res.valueOf()).to.equal(1586336280000);
            });

            it('should pass through unrecognised strings as-is', () => {
                let res = parse('Test string with no particular format');
                expect(res).to.equal("Test string with no particular format");
            });
        });

        describe('array', () => {
            it('should recursively parse its contents', () => {
                let list = [
                    "s:A string",
                    "n:22.7 °C",
                    "r:cb883beb-f19d-49ab-87cf-97f944ef3ae9 A ref"
                ];

                let res = parse(list);
                expect(res).to.be.instanceof(Array);
                expect(res.length).to.equal(3);

                expect(res[0]).to.equal('A string');

                expect(res[1]).to.be.instanceof(HSNumber);
                expect(res[1].value).to.equal(22.7);
                expect(res[1].unit).to.equal('°C');

                expect(res[2]).to.be.instanceof(Ref);
                expect(res[2].id).to.equal(
                    'cb883beb-f19d-49ab-87cf-97f944ef3ae9'
                );
                expect(res[2].dis).to.equal('A ref');
            });
        });

        describe('dict', () => {
            it('should recursively dump its contents', () => {
                let dict = {
                    a: "s:A string",
                    b: "n:22.7 °C",
                    c: "r:cb883beb-f19d-49ab-87cf-97f944ef3ae9 A ref"
                };

                let res = parse(dict);
                expect(res).to.be.a('object');
                expect(res).to.contain.all.keys('a', 'b', 'c');

                expect(res.a).to.equal('A string');

                expect(res.b).to.be.instanceof(HSNumber);
                expect(res.b.value).to.equal(22.7);
                expect(res.b.unit).to.equal('°C');

                expect(res.c).to.be.instanceof(Ref);
                expect(res.c.id).to.equal(
                    'cb883beb-f19d-49ab-87cf-97f944ef3ae9'
                );
                expect(res.c.dis).to.equal('A ref');
            });
        });

        describe('grid', () => {
            it('should recursively dump its contents', () => {
                let grid = {
                    meta: {
                        ver: '2.5',
                        gridTag: 'm:'
                    },
                    cols: [
                        {name: "c1", colTag: 's:a string'},
                        {name: "c2"}
                    ],
                    rows: [
                        {c1: 'r:abc', c2: 'n:123'}
                    ]
                };

                let res = parse(grid);

                expect(res.meta.gridTag).to.equal(MARKER);

                expect(res.cols[0].name).to.equal('c1');
                expect(res.cols[0].colTag).to.equal('a string');

                expect(res.cols[1].name).to.equal('c2');

                expect(res.rows[0].c1).to.be.instanceof(Ref);
                expect(res.rows[0].c1.id).to.equal('abc');

                expect(res.rows[0].c2).to.be.instanceof(HSNumber);
                expect(res.rows[0].c2.value).to.equal(123);
            });
        });
    });
});
