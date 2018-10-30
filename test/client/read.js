/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client read method
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
});
