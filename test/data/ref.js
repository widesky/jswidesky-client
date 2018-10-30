/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for Ref class
 * (C) 2018 VRT Systems
 */
"use strict";

const Ref = require('../../src/data').Ref,
    expect = require('chai').expect;


describe('data', () => {
    describe('Ref', () => {
        describe('constructor', () => {
            it('should create a Ref without display text', () => {
                let ref = new Ref('myreference');
                expect(ref.id).to.equal('myreference');
                expect(ref.dis).to.be.null;
            });

            it('should create a Ref with display text', () => {
                let ref = new Ref('myreference', 'My Display Text');
                expect(ref.id).to.equal('myreference');
                expect(ref.dis).to.equal('My Display Text');
            });

            it('should be able to clone a Ref-like object', () => {
                const fakeRef = {
                    id: 'abc123',
                    dis: 'My fake reference'
                };

                let ref = new Ref(fakeRef);

                expect(ref.id).to.equal('abc123');
                expect(ref.dis).to.equal('My fake reference');
            });

            it('should not clone object if dis also given', () => {
                const fakeRef = {
                    id: 'abc123',
                    dis: 'My fake reference'
                };

                try {
                    let ref = new Ref(fakeRef, 'a display text');
                    throw new Error('Constructor did not fail');
                } catch (err) {
                    if (err.message !==
                            'clone constructor takes a Ref only') {
                        throw err;
                    }
                }
            });

            it('should not clone object without string id', () => {
                const fakeRef = {
                    notid: 'abc123',
                    dis: 'My fake reference'
                };

                try {
                    let ref = new Ref(fakeRef);
                    throw new Error('Constructor did not fail');
                } catch (err) {
                    if (err.message !==
                            'clonee object \'id\' property must be a string') {
                        throw err;
                    }
                }
            });

            it('should not clone object with non-null, non-string dis', () => {
                const fakeRef = {
                    id: 'abc123',
                    dis: true
                };

                try {
                    let ref = new Ref(fakeRef);
                    throw new Error('Constructor did not fail');
                } catch (err) {
                    if (err.message !==
                            ('clonee object \'dis\' property must '
                            + 'be null or a string')) {
                        throw err;
                    }
                }
            });

            it('should not parse non-string', () => {
                try {
                    let ref = new Ref(false);
                    throw new Error('Constructor did not fail');
                } catch (err) {
                    if (err.message !== 'id is not a string') {
                        throw err;
                    }
                }
            });

            it('should not accept spaces in id if dis is given', () => {
                try {
                    let ref = new Ref('id with spaces', 'display text');
                    throw new Error('Constructor did not fail');
                } catch (err) {
                    if (err.message !== 'id may not contain spaces') {
                        throw err;
                    }
                }
            });

            it('should be able to parse a JSON-format ref '
                + 'without display text', () => {
                    let ref = new Ref('r:myjsonref');
                    expect(ref.id).to.equal('myjsonref');
                    expect(ref.dis).to.be.null;
                });

            it('should be able to parse a JSON-format ref '
                + 'with display text', () => {
                    let ref = new Ref('r:myjsonref-withds My display text');
                    expect(ref.id).to.equal('myjsonref-withds');
                    expect(ref.dis).to.equal('My display text');
                });

            it('should be able to parse a ZINC-format ref '
                + 'without display text', () => {
                    let ref = new Ref('@myzincref');
                    expect(ref.id).to.equal('myzincref');
                    expect(ref.dis).to.be.null;
                });

            it('should not parse a ZINC ref with malformed string', () => {
                try {
                    let ref = new Ref('@mybadref This is not a valid string');
                    throw new Error('Constructor did not fail');
                } catch (err) {
                    if (err.message !==
                            ('dis must be a valid ZINC string')) {
                        throw err;
                    }
                }
            });

            it('should be able to parse a ZINC-format ref '
                + 'with display text', () => {
                    let ref = new Ref('@myzincref "My display text"');
                    expect(ref.id).to.equal('myzincref');
                    expect(ref.dis).to.equal('My display text');
                });
        });

        describe('.toHSJSON', () => {
            it('should emit JSON string for ref without display text', () => {
                expect((new Ref('testRef')).toHSJSON()).to.equal('r:testRef');
            });

            it('should emit JSON string for ref with display text', () => {
                expect(
                    (new Ref('testRefWithDT', 'This has display text')).toHSJSON()
                ).to.equal('r:testRefWithDT This has display text');
            });
        });

        describe('.toHSZINC', () => {
            it('should emit ZINC string for ref without display text', () => {
                expect((new Ref('testRef')).toHSZINC()).to.equal('@testRef');
            });

            it('should emit ZINC string for ref with display text', () => {
                expect(
                    (new Ref('testRefWithDT', 'This has display text')).toHSZINC()
                ).to.equal('@testRefWithDT "This has display text"');
            });
        });
    });
});
