/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client history methods
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
    describe('hisRead', () => {
        it('should generate GET hisRead with range as-is '
            + 'if given string', () => {
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
                            uri: '/api/hisRead',
                            qs: {
                                'id': '@my.id',
                                'range': '"today"'
                            }
                        });

                        return Promise.resolve('grid goes here');
                    }
                ];

                http.setHandler((options) => {
                    expect(requestHandlers).to.not.be.empty;
                    return requestHandlers.shift()(options);
                });

                return ws.hisRead('my.id', 'today').then((res) => {
                    expect(res).to.equal('grid goes here');
                });
            });

        it('should generate GET hisRead with range defined by times', () => {
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
                        uri: '/api/hisRead',
                        qs: {
                            'id': '@my.id',
                            'range': '"2014-01-01T00:00:00.000Z UTC,'
                                    + '2018-01-01T00:00:00.000Z UTC"'
                        }
                    });

                    return Promise.resolve('grid goes here');
                }
            ];

            http.setHandler((options) => {
                expect(requestHandlers).to.not.be.empty;
                return requestHandlers.shift()(options);
            });

            return ws.hisRead(
                'my.id',
                new Date('2014-01-01T00:00Z'),
                new Date('2018-01-01T00:00Z')
            ).then((res) => {
                expect(res).to.equal('grid goes here');
            });
        });

        it('if given time range should require `from` to be a Date', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                return ws.hisRead(
                    'my.id',
                    false,
                    new Date('2018-01-01T00:00Z')
                ).then(() => {
                    throw new Error('This should not have worked');
                });
            } catch (err) {
                if (err.message !== '`from` is not a Date')
                    throw err;
            }
        });

        it('if given time range should require `to` to be a Date', () => {
            let http = new stubs.StubHTTPClient(),
                log = new stubs.StubLogger(),
                ws = getInstance(http, log);

            try {
                return ws.hisRead(
                    'my.id',
                    new Date('2018-01-01T00:00Z'),
                    false
                ).then(() => {
                    throw new Error('This should not have worked');
                });
            } catch (err) {
                if (err.message !== '`to` is not a Date')
                    throw err;
            }
        });
    });
});
