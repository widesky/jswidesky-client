/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for dump routines
 */
"use strict";

const dump = require('../../src/data').dump,
    sinon = require('sinon'),
    expect = require('chai').expect;


describe('data', () => {
    describe('dump', () => {
        const DUMMY_EXPECTED = {"val": "Dummy toHSJSON result"};
        function DummyType() {
            this.toHSJSON = sinon.stub().returns(DUMMY_EXPECTED);
        }

        describe('simple types', () => {
            it('should return false as-is', () => {
                expect(dump(false)).to.be.false;
            });
            it('should return true as-is', () => {
                expect(dump(true)).to.be.true;
            });
            it('should return null as-is', () => {
                expect(dump(null)).to.be.null;
            });
            it('should return undefined as null', () => {
                expect(dump(undefined)).to.be.null;
            });
        });

        describe('types implementing .toHSJSON', () => {
            it('should call value\'s .toHSJSON', () => {
                let val = new DummyType();
                expect(dump(val)).to.eql(DUMMY_EXPECTED);
                expect(val.toHSJSON.called).to.be.true;
                expect(val.toHSJSON.calledOnce).to.be.true;
            });
        });

        describe('array', () => {
            it('should recursively dump its contents', () => {
                let list = [
                    new DummyType(),
                    new DummyType(),
                    new DummyType()
                ];
                expect(dump(list)).to.eql([
                    DUMMY_EXPECTED,
                    DUMMY_EXPECTED,
                    DUMMY_EXPECTED
                ]);

                list.forEach((val, idx) => {
                    expect(val.toHSJSON.called,
                        `element ${idx} not called`).to.be.true;
                    expect(val.toHSJSON.calledOnce,
                        `element ${idx} called more than once`).to.be.true;
                });
            });
        });

        describe('dict', () => {
            it('should recursively dump its contents', () => {
                let dict = {
                    a: new DummyType(),
                    b: new DummyType(),
                    c: new DummyType()
                };
                expect(dump(dict)).to.eql({
                    a: DUMMY_EXPECTED,
                    b: DUMMY_EXPECTED,
                    c: DUMMY_EXPECTED
                });

                Object.keys(dict).forEach((tag) => {
                    let val = dict[tag];
                    expect(val.toHSJSON.called,
                        `element ${tag} not called`).to.be.true;
                    expect(val.toHSJSON.calledOnce,
                        `element ${tag} called more than once`).to.be.true;
                });
            });
        });

        describe('grid', () => {
            it('should recursively dump its contents', () => {
                let grid = {
                    meta: {
                        ver: '2.5',
                        gridTag: new DummyType()
                    },
                    cols: [
                        {name: "c1", colTag: new DummyType()},
                        {name: "c2"}
                    ],
                    rows: [
                        {c1: new DummyType(), c2: new DummyType()}
                    ]
                };

                expect(dump(grid)).to.eql({
                    meta: {
                        ver: "2.5",
                        gridTag: DUMMY_EXPECTED
                    },
                    cols: [
                        {name: "c1", colTag: DUMMY_EXPECTED},
                        {name: "c2"}
                    ],
                    rows: [
                        {c1: DUMMY_EXPECTED, c2: DUMMY_EXPECTED}
                    ]
                });

                expect(grid.meta.ver).to.equal('2.5');
                expect(grid.meta.gridTag.toHSJSON.called).to.be.true;
                expect(grid.meta.gridTag.toHSJSON.calledOnce).to.be.true;
                expect(grid.meta.gridTag.toHSJSON.calledWith('2.5')).to.be.true;

                expect(grid.cols[0].name).to.equal('c1');
                expect(grid.cols[0].colTag.toHSJSON.called).to.be.true;
                expect(grid.cols[0].colTag.toHSJSON.calledOnce).to.be.true;
                expect(grid.cols[0].colTag.toHSJSON.calledWith('2.5')).to.be.true;

                expect(grid.cols[1].name).to.equal('c2');

                expect(grid.rows[0].c1.toHSJSON.called).to.be.true;
                expect(grid.rows[0].c1.toHSJSON.calledOnce).to.be.true;
                expect(grid.rows[0].c1.toHSJSON.calledWith('2.5')).to.be.true;

                expect(grid.rows[0].c2.toHSJSON.called).to.be.true;
                expect(grid.rows[0].c2.toHSJSON.calledOnce).to.be.true;
                expect(grid.rows[0].c2.toHSJSON.calledWith('2.5')).to.be.true;
            });
        });
    });
});
