const proxyquire = require("proxyquire");
const { expect } = require("chai");
const stubs = require("../../stubs");
const http = require('http');
const https = require('https');

let passedAxiosOptions;
const WideSkyClient = proxyquire(
    "../../../src/client/client",
    {
        "axios": {
            create: (config) => {
                passedAxiosOptions = config;
                /* CORE-9226 (#178): initAxios now registers a response
                 * interceptor to capture the server's clock off the
                 * /oauth2/token response. Real axios -- node and browser both
                 * -- always exposes `.interceptors`; this stub returned
                 * nothing, so the registration threw inside the beforeEach and
                 * took every test in this block with it.
                 *
                 * Returning the minimal shape here, rather than guarding the
                 * client against a missing interceptor API, is deliberate: a
                 * guard would let a real axios that cannot register the
                 * interceptor skip the capture SILENTLY, which is precisely
                 * the failure mode the deadline fix exists to remove. Every
                 * assertion in this block reads `passedAxiosOptions` and is
                 * untouched by this change. */
                return {
                    interceptors: {
                        response: { use: () => {} }
                    }
                };
            }
        }
    }
);

describe("client", () => {
    let log;
    let ws;

    beforeEach(() => {
        log = new stubs.StubLogger();
        ws = new WideSkyClient(
            stubs.WS_URI,
            stubs.WS_USER,
            stubs.WS_PASSWORD,
            stubs.WS_CLIENT_ID,
            stubs.WS_CLIENT_SECRET,
            log
        );
    });

    describe("initAxios", () => {
        it('should only set baseURL and default agents if no options are specified', () => {
            ws.options = {};
            ws.initAxios();

            console.log(passedAxiosOptions);
            expect(Object.keys(passedAxiosOptions).length).to.equal(3);
            expect(passedAxiosOptions.baseURL).to.equal(stubs.WS_URI);

            expect(passedAxiosOptions.httpAgent instanceof http.Agent).to.be.true;
            expect(passedAxiosOptions.httpAgent.keepAlive).to.eql(true);
            expect(passedAxiosOptions.httpAgent.keepAliveMsecs).to.eql(1000);

            expect(passedAxiosOptions.httpsAgent instanceof https.Agent).to.be.true;
            expect(passedAxiosOptions.httpsAgent.keepAlive).to.eql(true);
            expect(passedAxiosOptions.httpsAgent.keepAliveMsecs).to.eql(1000);

            expect(passedAxiosOptions.adapter).to.be.undefined;
        });

        it("should pass options to axios client and agents if specified", () => {
            ws.options = {
                axios: {
                    test: 123
                },
                http: {
                    keepAlive: false,
                    keepAliveMsecs: 2000
                }
            };
            ws.initAxios();
            expect(Object.keys(passedAxiosOptions).length).to.equal(4);
            expect(passedAxiosOptions.baseURL).to.equal(stubs.WS_URI);
            expect(passedAxiosOptions.test).to.equal(123);

            expect(passedAxiosOptions.httpAgent instanceof http.Agent).to.be.true;
            expect(passedAxiosOptions.httpAgent.keepAlive).to.eql(false);
            expect(passedAxiosOptions.httpAgent.keepAliveMsecs).to.eql(2000);

            expect(passedAxiosOptions.httpsAgent instanceof https.Agent).to.be.true;
            expect(passedAxiosOptions.httpsAgent.keepAlive).to.eql(false);
            expect(passedAxiosOptions.httpsAgent.keepAliveMsecs).to.eql(2000);
        });

        it("should set keepAlive=true if not specified", () => {
            ws.options = {
                axios: {
                    test: 123
                },
                http: {
                    keepAliveMsecs: 2000
                }
            };
            ws.initAxios();
            expect(Object.keys(passedAxiosOptions).length).to.equal(4);
            expect(passedAxiosOptions.baseURL).to.equal(stubs.WS_URI);
            expect(passedAxiosOptions.test).to.equal(123);

            expect(passedAxiosOptions.httpAgent instanceof http.Agent).to.be.true;
            expect(passedAxiosOptions.httpAgent.keepAlive).to.eql(true);
            expect(passedAxiosOptions.httpAgent.keepAliveMsecs).to.eql(2000);

            expect(passedAxiosOptions.httpsAgent instanceof https.Agent).to.be.true;
            expect(passedAxiosOptions.httpsAgent.keepAlive).to.eql(true);
            expect(passedAxiosOptions.httpsAgent.keepAliveMsecs).to.eql(2000);
        });

        it("should not use the http2Adapter when http2.enabled=false", () => {
            ws.options = {
                http2: {
                    enabled: false,
                },
            };
            ws.initAxios();
            expect(Object.keys(passedAxiosOptions).length).to.equal(3);
            expect(passedAxiosOptions.adapter).to.be.undefined;
        });

        it("should not use the http2Adapter when http2.enabled=undefined", () => {
            ws.options = {
                http2: {},
            };
            ws.initAxios();
            expect(Object.keys(passedAxiosOptions).length).to.equal(3);
            expect(passedAxiosOptions.adapter).to.be.undefined;
        });

        it("should use the http2Adapter when http2.enabled=true", () => {
            ws.options = {
                http2: {
                    enabled: true,
                },
            };
            ws.initAxios();
            expect(Object.keys(passedAxiosOptions).length).to.equal(4);
            expect(passedAxiosOptions.adapter).to.not.equal(null);
        });
    });
});
