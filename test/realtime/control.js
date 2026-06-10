/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for the realtime point-write control helper.
 */
"use strict";

const expect = require("chai").expect;
const { RealtimeControl, COMMAND, WRITE_STATUS } =
    require("../../src/client/realtimeControl");

/**
 * Fake socket.io-client Socket that keeps inbound (server -> client) and
 * outbound (client -> server) separate, the way a real socket does: `emit`
 * records an outbound message and does NOT invoke local `message` listeners;
 * `_deliver` simulates the server pushing a message to the client.
 */
function makeFakeSocket() {
    const inbound = {};
    const sent = [];
    return {
        sent,
        on(event, cb) {
            inbound[event] = cb;
            return this;
        },
        removeListener(event, cb) {
            if (inbound[event] === cb) {
                delete inbound[event];
            }
        },
        emit(event, payload) {
            sent.push({ event, payload });
        },
        _deliver(event, payload) {
            if (inbound[event]) {
                inbound[event](payload);
            }
        },
        _hasListener(event) {
            return Object.prototype.hasOwnProperty.call(inbound, event);
        },
    };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("Realtime", function () {
    describe("RealtimeControl", function () {
        describe("responder role", function () {
            it("replies to a pointWrite request with a reportWrite", async function () {
                const sock = makeFakeSocket();
                const ctrl = new RealtimeControl(sock);

                ctrl.onPointWrite((rows) =>
                    rows.map((r) => ({ id: r.id, writeStatus: WRITE_STATUS.OK }))
                );

                sock._deliver("message", {
                    command: COMMAND.POINT_WRITE,
                    requestId: "req-1",
                    data: [{ id: "p1", value: 42 }],
                });

                await tick();

                expect(sock.sent).to.have.lengthOf(1);
                const resp = sock.sent[0].payload;
                expect(resp.command).to.equal(COMMAND.REPORT_WRITE);
                expect(resp.requestId).to.equal("req-1");
                expect(resp.responseId).to.be.a("string");
                expect(resp.responseId).to.not.equal("req-1");
                expect(resp.data).to.eql([{ id: "p1", writeStatus: "ok" }]);
            });

            it("reports fault for every point when the handler throws", async function () {
                const sock = makeFakeSocket();
                const ctrl = new RealtimeControl(sock);

                ctrl.onPointWrite(() => {
                    throw new Error("device offline");
                });

                sock._deliver("message", {
                    command: COMMAND.POINT_WRITE,
                    requestId: "req-2",
                    data: [{ id: "p1", value: 1 }, { id: "p2", value: 2 }],
                });

                await tick();

                const resp = sock.sent[0].payload;
                expect(resp.command).to.equal(COMMAND.REPORT_WRITE);
                expect(resp.data).to.eql([
                    { id: "p1", writeStatus: WRITE_STATUS.FAULT, writeErr: "device offline" },
                    { id: "p2", writeStatus: WRITE_STATUS.FAULT, writeErr: "device offline" },
                ]);
            });

            it("awaits an async handler before replying", async function () {
                const sock = makeFakeSocket();
                const ctrl = new RealtimeControl(sock);

                ctrl.onPointWrite(async (rows) => {
                    await tick();
                    return rows.map((r) => ({
                        id: r.id,
                        writeStatus: WRITE_STATUS.DOWN,
                        writeErr: "no comms",
                    }));
                });

                sock._deliver("message", {
                    command: COMMAND.POINT_WRITE,
                    requestId: "req-3",
                    data: [{ id: "p1", value: 9 }],
                });

                expect(sock.sent).to.have.lengthOf(0); // not replied synchronously
                await tick();
                await tick();
                expect(sock.sent[0].payload.data[0].writeStatus).to.equal(WRITE_STATUS.DOWN);
            });
        });

        describe("requestor role", function () {
            it("emits a pointWrite and resolves on the correlated response", async function () {
                const sock = makeFakeSocket();
                const ctrl = new RealtimeControl(sock);

                const promise = ctrl.pointWrite([{ id: "p1", value: 7 }], {
                    requestId: "req-4",
                    waitTimeout: 1000,
                });

                expect(sock.sent).to.have.lengthOf(1);
                expect(sock.sent[0].payload.command).to.equal(COMMAND.POINT_WRITE);
                expect(sock.sent[0].payload.requestId).to.equal("req-4");
                expect(sock.sent[0].payload.data).to.eql([{ id: "p1", value: 7 }]);

                sock._deliver("message", {
                    command: COMMAND.REPORT_WRITE,
                    requestId: "req-4",
                    responseId: "resp-4",
                    data: [{ id: "p1", writeStatus: WRITE_STATUS.OK }],
                    done: true,
                });

                const result = await promise;
                expect(result.requestId).to.equal("req-4");
                expect(result.data[0].writeStatus).to.equal(WRITE_STATUS.OK);
            });

            it("rejects when no response arrives within the wait timeout", async function () {
                const sock = makeFakeSocket();
                const ctrl = new RealtimeControl(sock);

                let rejected = null;
                try {
                    await ctrl.pointWrite([{ id: "p1", value: 1 }], {
                        requestId: "req-5",
                        waitTimeout: 20,
                    });
                } catch (err) {
                    rejected = err;
                }
                expect(rejected).to.be.an("error");
                expect(rejected.message).to.contain("req-5");
            });
        });

        describe("lifecycle", function () {
            it("removes its message listener and rejects pending requests on close()", async function () {
                const sock = makeFakeSocket();
                const ctrl = new RealtimeControl(sock);

                const promise = ctrl.pointWrite([{ id: "p1", value: 1 }], {
                    requestId: "req-6",
                    waitTimeout: 5000,
                });

                ctrl.close();

                let rejected = null;
                try {
                    await promise;
                } catch (err) {
                    rejected = err;
                }
                expect(rejected).to.be.an("error");
                expect(rejected.message).to.contain("closed");
                expect(sock._hasListener("message")).to.equal(false);
            });
        });
    });
});
