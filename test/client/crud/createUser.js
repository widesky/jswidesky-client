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

    describe('createUser', () => {
        beforeEach(() => {
            // Correct spy for function _wsRawSubmit()
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === "/oauth2/token") {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                } else if (uri === "/api/admin/user") {
                    return Promise.resolve("created");
                } else {
                    return Promise.reject(`Unexpected URI: ${uri}`);
                }
            });
        });

        afterEach(() => {
            ws._wsRawSubmit.reset();
        });

        it('should call up the createUser API', async () => {
            const USER_EMAIL = "user@example.com";
            const USER_DIS = "My new user for testing purposes";
            const USER_FUNC = "TestUser";
            const USER_ROLES = [
                "role1",
                "b160fdc0-d0ba-436e-9d18-143c1c4c0d37"
            ];
            const USER_PASSWORD = "asdfqetrwsdfasdfasdf";
            const USER_METHOD = "scram";

            const res = await ws.createUser(
                USER_EMAIL, USER_DIS, USER_FUNC, USER_ROLES, USER_PASSWORD, USER_METHOD
            );

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "PUT",
                "/api/admin/user",
                {
                    email: USER_EMAIL,
                    name: USER_DIS,
                    description: USER_FUNC,
                    roles: USER_ROLES,
                    password: USER_PASSWORD,
                    method: USER_METHOD
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );

            expect(res).to.equal("created");
        });

        it('should default to local authentication if method not given', async () => {
            const USER_EMAIL = "user@example.com";
            const USER_DIS = "My new user for testing purposes";
            const USER_FUNC = "TestUser";
            const USER_ROLES = [
                "role1",
                "b160fdc0-d0ba-436e-9d18-143c1c4c0d37"
            ];
            const USER_PASSWORD = "asdfqetrwsdfasdfasdf";

            const res = await ws.createUser(
                USER_EMAIL, USER_DIS, USER_FUNC, USER_ROLES, USER_PASSWORD
            );

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "PUT",
                "/api/admin/user",
                {
                    email: USER_EMAIL,
                    name: USER_DIS,
                    description: USER_FUNC,
                    roles: USER_ROLES,
                    password: USER_PASSWORD,
                    method: "local"
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );

            expect(res).to.equal("created");
        });

        it('should pass null password if password not given', async () => {
            const USER_EMAIL = "user@example.com";
            const USER_DIS = "My new user for testing purposes";
            const USER_FUNC = "TestUser";
            const USER_ROLES = [
                "role1",
                "b160fdc0-d0ba-436e-9d18-143c1c4c0d37"
            ];

            const res = await ws.createUser(
                USER_EMAIL, USER_DIS, USER_FUNC, USER_ROLES
            );

            expect(ws._wsRawSubmit.callCount).to.equal(2);
            verifyRequestCall(
                ws._wsRawSubmit.secondCall.args,
                "PUT",
                "/api/admin/user",
                {
                    email: USER_EMAIL,
                    name: USER_DIS,
                    description: USER_FUNC,
                    roles: USER_ROLES,
                    password: null,
                    method: "local"
                },
                {
                    headers: {
                        Authorization: `Bearer ${WS_ACCESS_TOKEN}`,
                        Accept: "application/json"
                    },
                    decompress: true
                }
            );

            expect(res).to.equal("created");
        });
    });
});