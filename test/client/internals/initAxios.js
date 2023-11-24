const proxyquire = require("proxyquire");
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
)
const { expect } = require("chai");
const stubs = require("../../stubs");
const {
    WS_URI,
    WS_USER,
    WS_PASSWORD,
    WS_CLIENT_ID,
    WS_CLIENT_SECRET
} = require("../../stubs");

describe("client", () => {
    let log;
    let ws;

    beforeEach(() => {
        log = new stubs.StubLogger();
        ws = new WideSkyClient(
            WS_URI, WS_USER, WS_PASSWORD, WS_CLIENT_ID, WS_CLIENT_SECRET, log
        );
    });

    describe("initAxios", () => {
        it("should pass options to axios client if specified", () => {
            ws.options = {
                axios: {
                    test: 123
                }
            };
            ws.initAxios();
            expect(passedAxiosOptions).to.eql({
                baseURL: WS_URI,
                test: 123
            });
        });
    });
});