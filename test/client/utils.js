const stubs = require('../stubs'),
    expect = require('chai').expect,
    WS_USER = stubs.WS_USER,
    WS_PASSWORD = stubs.WS_PASSWORD,
    WS_CLIENT_ID = stubs.WS_CLIENT_ID,
    WS_CLIENT_SECRET = stubs.WS_CLIENT_SECRET;

function verifyTokenCall(args) {
    expect(args[0]).to.equal("POST");
    expect(args[1]).to.equal("/oauth2/token");
    expect(args[2]).to.deep.equal({
        username: WS_USER,
        password: WS_PASSWORD,
        grant_type: "password"
    });
    expect(args[3]).to.deep.equal({
        auth: {
            username: WS_CLIENT_ID,
            password: WS_CLIENT_SECRET
        }
    });
}

function verifyRequestCall(stubArgs, method, uri, body, config) {
    expect(stubArgs[0]).to.equal(method);
    expect(stubArgs[1]).to.equal(uri);
    expect(stubArgs[2]).to.deep.equal(body);
    expect(stubArgs[3]).to.deep.equal(config);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
    verifyTokenCall,
    verifyRequestCall,
    sleep
}
