/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for client CRUD methods
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;
const {verifyRequestCall} = require("./../utils");

describe('client', () => {
    let ws, http, log;
    beforeEach(() => {
        http = new stubs.StubHTTPClient();
        log = new stubs.StubLogger();
        ws = getInstance(http, log);
    });

    describe('query', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/graphql") {
                    return Promise.resolve("Grid goes here");
                } else {
                    return Promise.reject("Did not expect to go this path");
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should wrap the GraphQL query and submit it', async () => {
            const res = await ws.query('graphql query here');
            expect(res).to.equal("Grid goes here");

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "POST",
                "/graphql",
                {
                    "query": "{ graphql query here }"
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );
        });

        describe('metadata', () => {
            it('should handle undefined metadata', async () => {
                await ws.query('graphql query here', undefined);

                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    'POST',
                    '/graphql',
                    {
                        query: '{ graphql query here }',
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: 'application/json',
                        },
                        decompress: true,
                    }
                );
            });

            it('should handle stringified metadata', async () => {
                const metadata = JSON.stringify({
                    testOne: 'simple string',
                    testTwo: { innerObject: 'inner string' },
                    testThree: ['value1', 'value2'],
                });
                await ws.query('graphql query here', metadata);

                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    'POST',
                    '/graphql',
                    {
                        query: '{ graphql query here }',
                        metadata: {
                            testOne: 'simple string',
                            testThree: ['value1', 'value2'],
                            testTwo: {
                                innerObject: 'inner string',
                            },
                        },
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: 'application/json',
                        },
                        decompress: true,
                    }
                );
            });

            it('should handle object metadata', async () => {
                const metadata = {
                    testOne: 'simple string',
                    testTwo: { innerObject: 'inner string' },
                    testThree: ['value1', 'value2'],
                };
                await ws.query('graphql query here', metadata);

                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    'POST',
                    '/graphql',
                    {
                        query: '{ graphql query here }',
                        metadata: {
                            testOne: 'simple string',
                            testThree: ['value1', 'value2'],
                            testTwo: {
                                innerObject: 'inner string',
                            },
                        },
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: 'application/json',
                        },
                        decompress: true,
                    }
                );
            });

            it('should handle malformed metadata (number)', async () => {
                const metadata = 200;
                await ws.query('graphql query here', metadata);

                expect(log.warn.callCount).to.equal(1);
                expect(log.warn.firstCall.args[0]).to.equal('Metadata failed to parse:');
                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    'POST',
                    '/graphql',
                    {
                        query: '{ graphql query here }',
                        // No metadata
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: 'application/json',
                        },
                        decompress: true,
                    }
                );
            });

            it('should handle malformed metadata (boolean)', async () => {
                const metadata = true;
                await ws.query('graphql query here', metadata);

                expect(log.warn.callCount).to.equal(1);
                expect(log.warn.firstCall.args[0]).to.equal('Metadata failed to parse:');
                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    'POST',
                    '/graphql',
                    {
                        query: '{ graphql query here }',
                        // No metadata
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: 'application/json',
                        },
                        decompress: true,
                    }
                );
            });

            it('should handle malformed metadata (malformed string)', async () => {
                const metadata = '{ badJSONObject: { ';
                await ws.query('graphql query here', metadata);

                expect(log.warn.callCount).to.equal(1);
                expect(log.warn.firstCall.args[0]).to.equal('Metadata failed to parse:');
                expect(ws._wsRawSubmit.callCount).to.equal(2);
                verifyRequestCall(
                    ws._wsRawSubmit.secondCall.args,
                    'POST',
                    '/graphql',
                    {
                        query: '{ graphql query here }',
                        // No metadata
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                            Accept: 'application/json',
                        },
                        decompress: true,
                    }
                );
            });
        });
    });
});