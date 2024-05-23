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
            expect(passedAxiosOptions.httpAgent.keepAlive).to.eql(false);
            expect(passedAxiosOptions.httpAgent.keepAliveMsecs).to.eql(1000);

            expect(passedAxiosOptions.httpsAgent instanceof https.Agent).to.be.true;
            expect(passedAxiosOptions.httpsAgent.keepAlive).to.eql(false);
            expect(passedAxiosOptions.httpsAgent.keepAliveMsecs).to.eql(1000);
        });

        it("should pass options to axios client and agents if specified", () => {
            ws.options = {
                axios: {
                    test: 123
                },
                http: {
                    keepAlive: true,
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
    });
});
