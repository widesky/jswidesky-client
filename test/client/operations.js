/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 * (C) 2018 VRT Systems
 */
"use strict";

const WideSkyClient = require('../../src/client'),
    stubs = require('../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_URI = stubs.WS_URI,
    WS_USER = stubs.WS_USER,
    WS_PASSWORD = stubs.WS_PASSWORD,
    WS_CLIENT_ID = stubs.WS_CLIENT_ID,
    WS_CLIENT_SECRET = stubs.WS_CLIENT_SECRET,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    WS_ACCESS_TOKEN2 = stubs.WS_ACCESS_TOKEN2,
    WS_REFRESH_TOKEN2 = stubs.WS_REFRESH_TOKEN2,
    getInstance = stubs.getInstance;


describe('client', () => {
    describe('read', () => {
        it('should generate GET read if given single ID as a string', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/read',
                            qs: {
                                'id': '@my.id'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.read('my.id').then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should generate GET read if given single ID in an array', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/read',
                            qs: {
                                'id': '@my.id'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.read(['my.id']).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should generate POST read if given multiple IDs', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/read',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [{name: "id"}],
                                rows: [
                                    {id: "r:my.id1"},
                                    {id: "r:my.id2"}
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.read(['my.id1', 'my.id2']).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    describe('reloadCache', () => {
        it('should call up reload cache api', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/reloadAuthCache'
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.reloadCache().then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    describe('updatePassword', () => {
        it('should call up the updatePassword api', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The updatePassword request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            body: {
                                "newPassword": "helloWorld!"
                            },
                            json: true,
                            method: 'POST',
                            uri: '/user/updatePassword'
                        });

                        return Promise.resolve('Password updated.');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.updatePassword("helloWorld!").then((res) => {
                expect(res).to.equal('Password updated.');
            });
        });
    });

    /* read-by-filter is handled by the `find` method */
    describe('find', () => {
        it('should generate GET read if given a filter and no limit', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/read',
                            qs: {
                                'filter': '"myTag==\\"my value\\""'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.find('myTag=="my value"').then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should include the limit if given', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/read',
                            qs: {
                                'filter': '"myTag==\\"my value\\""',
                                'limit': '30'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.find('myTag=="my value"', 30).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    describe('_create_or_update', () => {
        it('should automatically determine columns from entity data', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/CRUD_OP_HERE',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [
                                    /*
                                     * `id`, `name` and `dis` will be first.
                                     */
                                    {name: "id"},
                                    {name: "name"},
                                    {name: "dis"},
                                    {name: "a"},
                                    {name: "b"},
                                    {name: "c"}
                                ],
                                rows: [
                                    {
                                        id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                                        a: "s:test", b:true, c:"n:1234",
                                        dis: "s:My test entity", name: "s:testing"
                                    }
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws._create_or_update('CRUD_OP_HERE', {
                /* Note the order isn't preserved by objects anyway */
                name: "s:testing",
                c: "n:1234",
                dis: "s:My test entity",
                b: true,
                a: "s:test",
                id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
            }).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should automatically use Haystack 3.0 if needed', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/CRUD_OP_HERE',
                            body: {
                                meta: {ver: "3.0"},
                                cols: [
                                    /*
                                     * `id`, `name` and `dis` will be first.
                                     */
                                    {name: "id"},
                                    {name: "name"},
                                    {name: "dis"},
                                    {name: "a"},
                                    {name: "b"},
                                    {name: "c"}
                                ],
                                rows: [
                                    {
                                        id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                                        a: "s:test", b:true, c:[
                                            "n:1234",
                                            "n:2345",
                                            "n:3456"
                                        ], dis: "s:My test entity", name: "s:testing"
                                    }
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws._create_or_update('CRUD_OP_HERE', {
                /* Note the order isn't preserved by objects anyway */
                name: "s:testing",
                c: ["n:1234", "n:2345", "n:3456"],
                dis: "s:My test entity",
                b: true,
                a: "s:test",
                id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
            }).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should include all columns seen in all entities', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/CRUD_OP_HERE',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [
                                    /*
                                     * `id`, `name` and `dis` will be first.
                                     */
                                    {name: "id"},
                                    {name: "name"},
                                    {name: "dis"},
                                    {name: "a"},
                                    {name: "b"},
                                    {name: "c"},
                                    {name: "d"},
                                    {name: "e"},
                                    {name: "f"},
                                    {name: "g"}
                                ],
                                rows: [
                                    {
                                        dis: "s:Entity with dis and name",
                                        e: "m:",
                                        f: "t:2018-10-31T07:36+10:00 Brisbane",
                                        name: "s:noid"
                                    },
                                    {
                                        b: false,
                                        g: "r:aref",
                                        id: "r:364d7c7f-e227-40d6-a6aa-6e57d29ba311",
                                        name: "s:nodis"
                                    },
                                    {
                                        id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                                        a: "s:test", b:true, c:"n:1234", d: false,
                                        dis: "s:Entity with id, dis and name",
                                        name: "s:testing"
                                    }
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws._create_or_update('CRUD_OP_HERE', [
                {
                    name: "s:noid",
                    f: "t:2018-10-31T07:36+10:00 Brisbane",
                    dis: "s:Entity with dis and name",
                    e: "m:"
                },
                {
                    name: "s:nodis",
                    id: "r:364d7c7f-e227-40d6-a6aa-6e57d29ba311",
                    g: "r:aref",
                    b: false
                },
                {
                    name: "s:testing",
                    c: "n:1234",
                    dis: "s:Entity with id, dis and name",
                    b: true,
                    d: false,
                    a: "s:test",
                    id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
                }
            ]).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    describe('create', () => {
        it('should generate createRec request', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/createRec',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [
                                    /*
                                     * `id`, `name` and `dis` will be first.
                                     */
                                    {name: "id"},
                                    {name: "name"},
                                    {name: "dis"},
                                    {name: "a"},
                                    {name: "b"},
                                    {name: "c"}
                                ],
                                rows: [
                                    {
                                        id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                                        a: "s:test", b:true, c:"n:1234",
                                        dis: "s:My test entity", name: "s:testing"
                                    }
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.create({
                name: "s:testing",
                c: "n:1234",
                dis: "s:My test entity",
                b: true,
                a: "s:test",
                id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
            }).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should not require `id`', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/createRec',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [
                                    {name: "name"},
                                    {name: "dis"},
                                    {name: "a"},
                                    {name: "b"},
                                    {name: "c"}
                                ],
                                rows: [
                                    {
                                        a: "s:test", b:true, c:"n:1234",
                                        dis: "s:My test entity", name: "s:testing"
                                    }
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.create({
                name: "s:testing",
                c: "n:1234",
                dis: "s:My test entity",
                b: true,
                a: "s:test",
            }).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    describe('update', () => {
        it('should generate updateRec request', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/updateRec',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [
                                    /*
                                     * `id`, `name` and `dis` will be first.
                                     */
                                    {name: "id"},
                                    {name: "name"},
                                    {name: "dis"},
                                    {name: "a"},
                                    {name: "b"},
                                    {name: "c"}
                                ],
                                rows: [
                                    {
                                        id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09",
                                        a: "s:test", b:true, c:"n:1234",
                                        dis: "s:My test entity", name: "s:testing"
                                    }
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.update({
                name: "s:testing",
                c: "n:1234",
                dis: "s:My test entity",
                b: true,
                a: "s:test",
                id: "r:cf60bce8-da3b-4c96-a4f8-f7a6580ede09"
            }).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should require `id`', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                return ws.update({
                    name: "s:testing",
                    c: "n:1234",
                    dis: "s:My test entity",
                    b: true,
                    a: "s:test",
                }).then((res) => {
                    throw new Error('This should not have worked');
                });
            } catch (err) {
                if (err.message !== 'id is missing')
                    throw err;
            }
        });
    });

    describe('deleteById', () => {
        it('should generate GET delete if given single ID as a string', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/deleteRec',
                            qs: {
                                'id': '@my.id'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.deleteById('my.id').then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should generate GET delete if given single ID in an array', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/deleteRec',
                            qs: {
                                'id': '@my.id'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.deleteById(['my.id']).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should generate POST deleteById if given multiple IDs', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'POST',
                            uri: '/api/deleteRec',
                            body: {
                                meta: {ver: "2.0"},
                                cols: [{name: "id"}],
                                rows: [
                                    {id: "r:my.id1"},
                                    {id: "r:my.id2"}
                                ]
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.deleteById(['my.id1', 'my.id2']).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });

    /* read-by-filter is handled by the `find` method */
    describe('deleteByFilter', () => {
        it('should generate GET delete if given a filter and no limit', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

                /* We expect the following requests */
                let requestHandlers = [
                    /* First up, an authentication request */
                    stubs.authHandler(),
                    /* The read request is next */
                    (options) => {
                        expect(options).to.eql({
                            baseUrl: WS_URI,
                            headers: {
                                Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                                Accept: 'application/json'
                            },
                            json: true,
                            method: 'GET',
                            uri: '/api/deleteRec',
                            qs: {
                                'filter': '"myTag==\\"my value\\""'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

            return ws.deleteByFilter('myTag=="my value"').then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('should include the limit if given', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            /* We expect the following requests */
            let requestHandlers = [
                /* First up, an authentication request */
                stubs.authHandler(),
                /* The read request is next */
                (options) => {
                    expect(options).to.eql({
                        baseUrl: WS_URI,
                        headers: {
                            Authorization: 'Bearer ' + WS_ACCESS_TOKEN,
                            Accept: 'application/json'
                        },
                        json: true,
                        method: 'GET',
                        uri: '/api/deleteRec',
                        qs: {
                            'filter': '"myTag==\\"my value\\""',
                            'limit': '30'
                        }
                    });

                    return Promise.resolve('grid goes here');
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.deleteByFilter('myTag=="my value"', 30).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });
    });
});
