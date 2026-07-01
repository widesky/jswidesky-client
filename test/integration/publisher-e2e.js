/*
 * vim: set tw=100 et ts=4 sw=4 si fileencoding=utf-8:
 * © 2026 WideSky.Cloud Pty Ltd
 * SPDX-License-Identifier: MIT
 */
"use strict";

/**
 * End-to-end integration spec for the realtime cur-ingress publisher
 * (PublisherSession, CORE-8664) against a LIVE apiserver stack.
 *
 * Exercises ONLY the public client API: WideSkyClient + client.createPublisher()
 * for the producer side, and WideSkyClient.watchSub / getWatchSocket for the
 * consumer side. The flow mirrors the apiserver grp16_publisher system suite but
 * drives it through the jswidesky-client surface a customer edge would use.
 *
 * SKIPPED unless WS_E2E_URL is set, so the default unit suite stays green and
 * offline. Run against a broker-less publisher stack:
 *
 *   WS_E2E_URL=http://localhost:3000 \
 *   WS_E2E_USER=<superuser-email> WS_E2E_PASS=<password> \
 *   WS_E2E_CLIENT_ID=<oauth-client-id> \
 *   WS_E2E_CLIENT_SECRET=<oauth-client-secret> \
 *   npx mocha test/integration/publisher-e2e.js
 *
 * Fixtures: the spec creates (idempotently, lookup-first) its OWN disjoint point
 * set under a dedicated site/equip (jsclient_e2e.*) so it never collides with the
 * grp16 publisherTestSite fixtures. Points are reused across runs (the stack is
 * not torn down), so the suite is repeatable.
 */

const expect = require("chai").expect;
const { WideSkyClient } = require("../../index");

/* ---- environment gate + config ---- */
const WS_E2E_URL = process.env.WS_E2E_URL;
const E2E_USER = process.env.WS_E2E_USER;
const E2E_PASS = process.env.WS_E2E_PASS;
const E2E_CLIENT_ID = process.env.WS_E2E_CLIENT_ID;
const E2E_CLIENT_SECRET = process.env.WS_E2E_CLIENT_SECRET;

/* ---- fixture naming (disjoint from grp16's publisherTestSite) ---- */
const SITE_FQNAME = "jsclient_e2e";
const EQUIP_FQNAME = SITE_FQNAME + ".jsclient_e2e_equip";
const POINTS = [
    { key: "num", name: "jsclient_e2e_num", kind: "Number", unit: "kW" },
    /* bool carries the 'writable' marker: the apiserver pointWrite/controlSub
     * validator (hsOperationManager.onPointWrite / controlCmdRouter) rejects a
     * control write to any point lacking it ("Entity <id> is not writable").
     * step 8 drives a pointWrite at this point. */
    { key: "bool", name: "jsclient_e2e_bool", kind: "Bool", writable: true },
    { key: "str", name: "jsclient_e2e_str", kind: "Str" }
];

/* Server hysteresis defaults (design §9). */
const DEMAND_CLEAR_DELAY_MS = 5000;

/* ---- small async helpers ---- */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pointFqname(key) {
    const entry = POINTS.find((p) => p.key === key);
    if (!entry) {
        throw new Error("unknown fixture point key: " + key);
    }
    return EQUIP_FQNAME + "." + entry.name;
}

function makeClient() {
    return new WideSkyClient(
        WS_E2E_URL,
        E2E_USER,
        E2E_PASS,
        E2E_CLIENT_ID,
        E2E_CLIENT_SECRET,
        { level: "error" }
    );
}

/**
 * Bare uuid out of a haystack ref id ('r:<uuid> <dis>' or 's:<fqname>').
 */
function bareId(rawId) {
    return rawId.substring(2).split(" ")[0];
}

/**
 * Idempotent lookup-first: resolve an entity's bare uuid by fqname, or null if
 * it does not exist. Uses the public find() API (filter read).
 */
async function resolveByFqname(client, fqname) {
    const resp = await client.find(`id==@${fqname}`, 0);
    const rows = (resp && resp.rows) || [];
    if (rows.length === 1) {
        return bareId(rows[0].id);
    }
    return null;
}

/**
 * Create-or-reuse the site / equip / 3 points. Returns { num, bool, str }
 * bare-uuid map. Lookup-first per entity so a re-run never 400s on duplicates.
 */
async function ensureFixtures(client) {
    /* Site. */
    if (!(await resolveByFqname(client, SITE_FQNAME))) {
        await client.create({
            name: "s:" + SITE_FQNAME,
            dis: "s:JS Client E2E Site",
            site: "m:",
            tz: "s:Brisbane"
        });
    }

    /* Equip. */
    if (!(await resolveByFqname(client, EQUIP_FQNAME))) {
        await client.create({
            name: "s:jsclient_e2e_equip",
            dis: "s:JS Client E2E Equip",
            equip: "m:",
            siteRef: "r:" + SITE_FQNAME,
            tz: "s:Brisbane"
        });
    }

    /* Points (one create per missing point; createRec is all-or-nothing). */
    for (const p of POINTS) {
        if (await resolveByFqname(client, pointFqname(p.key))) {
            continue;
        }
        const entity = {
            name: "s:" + p.name,
            dis: "s:" + p.name,
            point: "m:",
            cur: "m:",
            kind: "s:" + p.kind,
            equipRef: "r:" + EQUIP_FQNAME,
            siteRef: "r:" + SITE_FQNAME,
            tz: "s:Brisbane"
        };
        if (p.unit) {
            entity.unit = "s:" + p.unit;
        }
        if (p.writable) {
            /* The apiserver control-write validator requires the 'writable'
             * marker (SemanticVars.REALTIME_POINT_WRITABLE) on the point. */
            entity.writable = "m:";
        }
        await client.create(entity);
    }

    const ids = {};
    for (const p of POINTS) {
        const id = await resolveByFqname(client, pointFqname(p.key));
        if (!id) {
            throw new Error(
                "fixture point did not resolve after create: " + p.key);
        }
        ids[p.key] = id;
    }

    /* Points reused from an earlier run predate the 'writable' marker, so patch
     * it in idempotently (setting a marker that already exists is a no-op).
     * Without it, step 8's pointWrite 400s with "Entity <id> is not writable". */
    for (const p of POINTS) {
        if (p.writable) {
            await client.update([{ id: "r:" + ids[p.key], writable: "m:" }]);
        }
    }

    return ids;
}

/* ---- consumer harness (public API only) ---- */

/**
 * A pure-consumer watch over the public client surface: watchSub + getWatchSocket
 * with the repo's WideSkyConnected open handshake. Collects pointData frames.
 */
class Consumer {
    constructor(client) {
        this.client = client;
        this.watchId = null;
        this.socket = null;
        this.frames = [];
    }

    async open(pointIds, title) {
        const sub = await this.client.watchSub(pointIds, "n:120 sec", title);
        this.watchId = sub.meta.watchId.substring(2);
        const sock = this.client.getWatchSocket(this.watchId);
        sock.on("pointData", (frame) => this.frames.push(frame));
        this.socket = sock;
        await new Promise((resolve, reject) => {
            const t = setTimeout(
                () => reject(new Error("consumer socket connect timed out")),
                10000);
            sock.on("WideSkyConnected", () => { clearTimeout(t); resolve(); });
            sock.on("connection_error", (e) => { clearTimeout(t); reject(e); });
            sock.open();
        });
        return this;
    }

    /** Resolve with the first frame for bareUuid satisfying predicate. */
    waitForFrame(bareUuid, predicate, timeoutMs) {
        timeoutMs = timeoutMs || 10000;
        const matches = (f) =>
            typeof f.id === "string"
            && bareId(f.id) === bareUuid
            && predicate(f);
        return new Promise((resolve, reject) => {
            const existing = this.frames.find(matches);
            if (existing) {
                return resolve(existing);
            }
            const start = Date.now();
            const poll = setInterval(() => {
                const hit = this.frames.find(matches);
                if (hit) {
                    clearInterval(poll);
                    return resolve(hit);
                }
                if (Date.now() - start > timeoutMs) {
                    clearInterval(poll);
                    return reject(new Error(
                        `Timed out waiting for pointData on ${bareUuid}; `
                        + `frames=${JSON.stringify(this.frames)}`));
                }
            }, 50);
        });
    }

    /** Detach the socket (drives the publisher's point toward warm/idle). */
    detach() {
        if (this.socket && this.socket.connected) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
        }
        this.socket = null;
    }

    async close() {
        this.detach();
        if (this.watchId) {
            try {
                await this.client.watchUnsub(this.watchId, [], true);
            }
            catch (err) { /* best effort: watch may already be gone */ }
            this.watchId = null;
        }
    }
}

/**
 * Read a point's cur triad over plain REST (no socket). The client exposes no
 * watchPoll wrapper, so step 4's poll surface is exercised through find().
 */
async function readCur(client, bareUuid) {
    const resp = await client.find(`id==@${bareUuid}`, 0);
    const row = (resp && resp.rows && resp.rows[0]) || {};
    return {
        curVal: row.curVal,
        curStatus: row.curStatus,
        curErr: row.curErr
    };
}

async function readCurUntil(client, bareUuid, predicate, timeoutMs, label) {
    const start = Date.now();
    for (;;) {
        const cur = await readCur(client, bareUuid);
        if (predicate(cur)) {
            return cur;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(
                `Timed out (${timeoutMs}ms) reading cur for ${label}; `
                + `last=${JSON.stringify(cur)}`);
        }
        await delay(250);
    }
}

/**
 * Raw /api/watchPoll over the client's submitRequest pipeline (the client has no
 * dedicated watchPoll wrapper). Returns the polled row for bareUuid.
 */
async function watchPollRow(client, pollWatchId, bareUuid) {
    const resp = await client.submitRequest("POST", "/api/watchPoll", {
        meta: { ver: "2.0", watchId: "s:" + pollWatchId, refresh: "m:" },
        cols: [{ name: "empty" }],
        rows: []
    });
    return (resp.rows || []).find(
        (r) => typeof r.id === "string" && bareId(r.id) === bareUuid);
}

/**
 * Issue an /api/pointWrite over the client's submitRequest pipeline (the client
 * has no dedicated pointWrite wrapper). Routes a control command to the point's
 * registered control listeners and resolves once settled. Returns the response
 * grid.
 */
async function pointWrite(client, bareUuid, level, val, who) {
    return client.submitRequest("POST", "/api/pointWrite", {
        meta: { ver: "2.0" },
        cols: [
            { name: "id" },
            { name: "level" },
            { name: "val" },
            { name: "who" }
        ],
        rows: [
            {
                id: "r:" + bareUuid,
                level: "n:" + level,
                val: val,
                who: "s:" + who
            }
        ]
    });
}

async function watchPollUntil(client, pollWatchId, bareUuid, predicate,
                              timeoutMs, label) {
    const start = Date.now();
    for (;;) {
        const row = await watchPollRow(client, pollWatchId, bareUuid);
        if (row && predicate(row)) {
            return row;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(
                `Timed out (${timeoutMs}ms) polling watchPoll for ${label}; `
                + `last=${JSON.stringify(row)}`);
        }
        await delay(250);
    }
}

/* ================================================================= */

describe("Realtime publisher E2E (live apiserver)", function () {
    this.timeout(90000);
    this.slow(30000);

    /* Skip the whole suite unless explicitly pointed at a live stack. */
    before(function () {
        if (!WS_E2E_URL) {
            console.log(
                "[publisher-e2e] integration tests skipped: WS_E2E_URL unset " +
                "(set it to run against a live WideSky apiserver)"
            );
            this.skip();
        }
    });

    let owner;          /* publisher-side client */
    let consumerClient; /* consumer-side client (distinct WideSkyClient) */
    let ids;            /* { num, bool, str } bare uuids */

    before("login + fixtures", async function () {
        owner = makeClient();
        await owner.login();
        consumerClient = makeClient();
        await consumerClient.login();
        ids = await ensureFixtures(owner);
    });

    /* Run the whole functional body TWICE to prove the suite is repeatable. */
    [1, 2].forEach((pass) => {
        describe(`pass ${pass}`, function () {
            const results = {};

            it("step 1: fixtures present (create-or-reuse, disjoint set)",
                async function () {
                    expect(ids.num).to.match(/^[0-9a-f]{8}-/);
                    expect(ids.bool).to.match(/^[0-9a-f]{8}-/);
                    expect(ids.str).to.match(/^[0-9a-f]{8}-/);
                    results.fixtures = true;
                });

            it("step 2: watchPub fresh w/ inline initial value, connect, "
                + "receive connect-time pointCadence burst",
                async function () {
                    const pub = owner.createPublisher();
                    const cadences = [];
                    pub.on("pointCadence", (p) => cadences.push(p));

                    /* A connected consumer keeps the point in demand (fast
                     * cadence) for the burst. */
                    const consumer = new Consumer(consumerClient);
                    await consumer.open([ids.num], this.test.fullTitle());

                    try {
                        const resp = await pub.watchPub({
                            data: [{
                                id: ids.num,
                                intervalFast: 1000,
                                curVal: 11.5,
                                curStatus: "ok"
                            }]
                        });
                        expect(resp.watchId).to.be.a("string");
                        expect(resp.data).to.have.lengthOf(1);
                        expect(resp.data[0].status).to.equal("registered");

                        await pub.connect(resp.watchId);

                        /* Connect-time burst: a pointCadence for the claimed
                         * point must arrive without any pointUpdate. */
                        await new Promise((resolve, reject) => {
                            const t = setTimeout(() => reject(new Error(
                                "no connect-time pointCadence burst; cadences="
                                + JSON.stringify(cadences))), 8000);
                            const poll = setInterval(() => {
                                const hit = cadences.some((d) =>
                                    (d.data || []).some(
                                        (e) => e.id === ids.num));
                                if (hit) {
                                    clearInterval(poll);
                                    clearTimeout(t);
                                    resolve();
                                }
                            }, 50);
                        });

                        /* The inline initial value must reach the subscriber. */
                        const frame = await consumer.waitForFrame(
                            ids.num, (f) => f.curVal === "n:11.5");
                        expect(frame.curStatus).to.equal("s:ok");
                        results.connectBurst = true;
                    }
                    finally {
                        await consumer.close();
                        await pub.close({ unpub: true });
                    }
                });

            it("step 3: a SECOND consumer client receives pointUpdate-driven "
                + "pointData triads (ok value change + custom curErr)",
                async function () {
                    const pub = owner.createPublisher();
                    /* Distinct consumer WideSkyClient (the 'second client'). */
                    const consumer = new Consumer(consumerClient);
                    await consumer.open(
                        [ids.num, ids.bool, ids.str], this.test.fullTitle());

                    try {
                        const resp = await pub.watchPub({
                            data: [
                                { id: ids.num, intervalFast: 1000 },
                                { id: ids.bool, intervalFast: 1000 },
                                { id: ids.str, intervalFast: 1000 }
                            ]
                        });
                        await pub.connect(resp.watchId);

                        /* ok value change across all three kinds. */
                        pub.pointUpdate([
                            { id: ids.num, curVal: 42.5 },
                            { id: ids.bool, curVal: true },
                            { id: ids.str, curVal: "hello" }
                        ]);

                        const numFrame = await consumer.waitForFrame(
                            ids.num, (f) => f.curVal === "n:42.5");
                        expect(numFrame.curStatus).to.equal("s:ok");
                        /* ok → canonical empty curErr → null on the wire. */
                        expect(numFrame.curErr).to.equal(null);

                        const boolFrame = await consumer.waitForFrame(
                            ids.bool, (f) => f.curVal === true);
                        expect(boolFrame.curStatus).to.equal("s:ok");

                        const strFrame = await consumer.waitForFrame(
                            ids.str, (f) => f.curVal === "s:hello");
                        expect(strFrame.curStatus).to.equal("s:ok");

                        /* custom curErr case: explicit down + verbatim curErr. */
                        const CUSTOM = "Sensor fault (e2e)";
                        pub.pointUpdate([{
                            id: ids.num,
                            curStatus: "down",
                            curErr: CUSTOM
                        }]);
                        const downFrame = await consumer.waitForFrame(
                            ids.num, (f) => f.curStatus === "s:down");
                        expect(downFrame.curErr).to.equal("s:" + CUSTOM);

                        results.triads = true;
                    }
                    finally {
                        await consumer.close();
                        await pub.close({ unpub: true });
                    }
                });

            it("step 4: demand cycle — both halves of the v2 freshness "
                + "contract on demand-clear",
                async function () {
                    /* Demand is reference-counted on CONSUMER-WATCH presence, not
                     * on a subscriber socket. A point drops out of demand only
                     * when EVERY watch holding it unsubscribes; the socket
                     * transport is demand-neutral. After the hysteresis window
                     * the v2 freshness contract then differs by declaration:
                     *
                     *   - a SLEEPER (intervalSlow == 0) is set to idle (curVal
                     *     null, s:idle, canonical idle curErr) and broadcast; and
                     *   - a SLOW-DATA point (intervalSlow > 0) gets NO status
                     *     write — it retains its last ok value and is only aged to
                     *     stale later by the slow-tier sweeper.
                     *
                     * This step exercises BOTH halves on the same demand-clear:
                     * num is the sleeper (must go idle), bool is the slow-data
                     * point (must stay ok). */
                    const pub = owner.createPublisher();

                    /* Socket consumer over BOTH points. The socket drives the
                     * fan-out but is NOT the demand source; the watchSub backing
                     * it is. */
                    const socketConsumer = new Consumer(consumerClient);
                    await socketConsumer.open(
                        [ids.num, ids.bool], this.test.fullTitle());

                    try {
                        const resp = await pub.watchPub({
                            data: [
                                /* sleeper: intervalSlow defaults to 0. */
                                { id: ids.num, intervalFast: 20000 },
                                /* slow-data: intervalSlow large enough that the
                                 * slow-tier sweeper (stale at intervalSlow × 2.5)
                                 * cannot fire during this step's budget. */
                                {
                                    id: ids.bool,
                                    intervalFast: 20000,
                                    intervalSlow: 60000
                                }
                            ]
                        });
                        await pub.connect(resp.watchId);

                        /* Drive ok on both so there is a value to observe. */
                        pub.pointUpdate([
                            { id: ids.num, curVal: 63.5 },
                            { id: ids.bool, curVal: true }
                        ]);
                        await socketConsumer.waitForFrame(
                            ids.num,
                            (f) => f.curStatus === "s:ok"
                                && f.curVal === "n:63.5");
                        await socketConsumer.waitForFrame(
                            ids.bool,
                            (f) => f.curStatus === "s:ok" && f.curVal === true);

                        /* Both read ok via REST while in demand. */
                        const okNum = await readCurUntil(
                            consumerClient, ids.num,
                            (c) => c.curStatus === "s:ok"
                                && typeof c.curVal === "string"
                                && c.curVal.startsWith("n:63.5"),
                            10000, "num ok via REST");
                        expect(okNum.curStatus).to.equal("s:ok");
                        const okBool = await readCurUntil(
                            consumerClient, ids.bool,
                            (c) => c.curStatus === "s:ok" && c.curVal === true,
                            10000, "bool ok via REST");
                        expect(okBool.curStatus).to.equal("s:ok");

                        /* Drop demand to ZERO: socket detach alone does not lower
                         * demand, so the holding watch must be fully released.
                         * close() detaches the socket AND watchUnsubs the watch
                         * covering both points. */
                        await socketConsumer.close();

                        /* --- sleeper half: num goes idle --- */
                        const idleCur = await readCurUntil(
                            consumerClient, ids.num,
                            (c) => c.curStatus === "s:idle",
                            DEMAND_CLEAR_DELAY_MS + 15000, "num idle via REST");
                        expect(idleCur.curStatus).to.equal("s:idle");
                        /* idle clears the value to haystack NA ('z:' on the wire)
                         * and carries the canonical idle curErr. */
                        expect(idleCur.curVal, "idle clears curVal to NA")
                            .to.equal("z:");
                        expect(idleCur.curErr).to.equal(
                            "s:Publisher asleep, no data expected.");

                        /* A FRESH watchPoll watch created after idle seeds from
                         * the persisted idle cur tags (CORE-8652 bridge fix). It
                         * re-raises demand, but the seed already reflects idle. */
                        const idlePollSub = await consumerClient.watchSub(
                            [ids.num], "n:120 sec",
                            this.test.fullTitle() + " (idle poll)");
                        const idlePollWatchId =
                            idlePollSub.meta.watchId.substring(2);
                        try {
                            const idlePoll = await watchPollRow(
                                consumerClient, idlePollWatchId, ids.num);
                            expect(idlePoll, "fresh watchPoll sees the point")
                                .to.be.an("object");
                            expect(idlePoll.curStatus).to.equal("s:idle");
                        }
                        finally {
                            try {
                                await consumerClient.watchUnsub(
                                    idlePollWatchId, [], true);
                            }
                            catch (err) { /* best effort */ }
                        }

                        /* --- slow-data half: bool stays ok (no status write on
                         * demand-clear; ages to stale only via the sweeper, well
                         * outside this budget). Wait out the full hysteresis +
                         * idle budget the sleeper needed, then assert bool is
                         * STILL ok. --- */
                        const stillOk = await readCur(consumerClient, ids.bool);
                        expect(stillOk.curStatus,
                            "slow-data point keeps ok on demand-clear")
                            .to.equal("s:ok");
                        expect(stillOk.curVal, "slow-data point keeps its value")
                            .to.equal(true);

                        results.demandCycle = true;
                    }
                    finally {
                        await socketConsumer.close();
                        await pub.close({ unpub: true });
                    }
                });

            it("step 5: referenced-update (add a point, drop a point) + "
                + "supersede recovery (fresh watchPub same points)",
                async function () {
                    const pub = owner.createPublisher();
                    const consumer = new Consumer(consumerClient);
                    await consumer.open(
                        [ids.num, ids.bool], this.test.fullTitle());

                    try {
                        /* Fresh watch on num only. */
                        const fresh = await pub.watchPub({
                            data: [{ id: ids.num, intervalFast: 1000 }]
                        });
                        const watchId = fresh.watchId;
                        await pub.connect(watchId);
                        pub.pointUpdate([{ id: ids.num, curVal: 1.0 }]);
                        await consumer.waitForFrame(
                            ids.num, (f) => f.curVal === "n:1");

                        /* Referenced update: REPLACE claim set with bool only.
                         * num is dropped (absent), bool is added. */
                        const updated = await pub.watchPub({
                            watchId: watchId,
                            data: [{ id: ids.bool, intervalFast: 1000 }]
                        });
                        expect(updated.watchId).to.equal(watchId);
                        const boolEntry = (updated.data || []).find(
                            (d) => d.id === ids.bool);
                        expect(boolEntry, "bool now claimed").to.be.an("object");
                        expect(boolEntry.status).to.equal("registered");

                        /* The newly added point publishes through the same
                         * watch/socket. */
                        pub.pointUpdate([{ id: ids.bool, curVal: true }]);
                        const boolFrame = await consumer.waitForFrame(
                            ids.bool, (f) => f.curVal === true);
                        expect(boolFrame.curStatus).to.equal("s:ok");

                        /* Supersede recovery: simulate state loss by closing the
                         * session WITHOUT unpub (claims linger under this user),
                         * then a brand-new session does a FRESH watchPub of the
                         * same points. Same-user supersede releases the old watch
                         * and re-claims here. */
                        await pub.close(); /* socket down, no unpub */

                        const pub2 = owner.createPublisher();
                        const superseded = await pub2.watchPub({
                            data: [{ id: ids.bool, intervalFast: 1000 }]
                        });
                        expect(superseded.watchId).to.be.a("string");
                        const reEntry = (superseded.data || []).find(
                            (d) => d.id === ids.bool);
                        expect(reEntry, "bool re-claimed by fresh watch")
                            .to.be.an("object");
                        expect(reEntry.status).to.equal("registered");

                        await pub2.connect(superseded.watchId);
                        pub2.pointUpdate([{ id: ids.bool, curVal: false }]);
                        const recovered = await consumer.waitForFrame(
                            ids.bool, (f) => f.curVal === false);
                        expect(recovered.curStatus).to.equal("s:ok");
                        await pub2.close({ unpub: true });

                        results.refUpdateSupersede = true;
                    }
                    finally {
                        await consumer.close();
                        await pub.close({ unpub: true });
                    }
                });

            it("step 6: disconnect grace → down; reconnect-within-grace → "
                + "no state change",
                async function () {
                    const GRACE_MS = 3000;
                    const DOWN_ERR = "Edge offline (e2e grace)";
                    const pub = owner.createPublisher();
                    const consumer = new Consumer(consumerClient);
                    await consumer.open([ids.num], this.test.fullTitle());

                    try {
                        const resp = await pub.watchPub({
                            onDisconnect: {
                                mode: "grace",
                                graceMs: GRACE_MS,
                                curStatus: "down",
                                curErr: DOWN_ERR
                            },
                            data: [{ id: ids.num, intervalFast: 20000 }]
                        });
                        const watchId = resp.watchId;
                        await pub.connect(watchId);
                        pub.pointUpdate([{ id: ids.num, curVal: 88.0 }]);
                        await consumer.waitForFrame(
                            ids.num, (f) => f.curStatus === "s:ok"
                                && f.curVal === "n:88");

                        /* --- reconnect-WITHIN-grace: no state change --- */
                        /* Drop the transport, then re-open the SAME namespace
                         * before grace elapses. socket.io reconnection on the
                         * session heals it. The point must NOT go down. */
                        pub.socket.disconnect();
                        await delay(800);
                        /* Re-open same watch (plain rejoin, no REST). */
                        await pub.connect(watchId);
                        /* Within the grace window the cur stays ok. */
                        await delay(GRACE_MS + 1000);
                        const stillOk = await readCur(consumerClient, ids.num);
                        expect(stillOk.curStatus,
                            "reconnect-within-grace keeps state").to.equal(
                            "s:ok");

                        /* --- full disconnect → down after grace --- */
                        pub.socket.removeAllListeners();
                        pub.socket.disconnect();
                        const downCur = await readCurUntil(
                            consumerClient, ids.num,
                            (c) => c.curStatus === "s:down",
                            GRACE_MS + 15000, "down after grace");
                        expect(downCur.curStatus).to.equal("s:down");
                        expect(downCur.curErr).to.equal("s:" + DOWN_ERR);

                        results.graceDisconnect = true;
                    }
                    finally {
                        await consumer.close();
                        await pub.close({ unpub: true });
                    }
                });

            it("step 7: teardown clean (watchUnpub releases claims)",
                async function () {
                    const pub = owner.createPublisher();
                    const resp = await pub.watchPub({
                        data: [{ id: ids.str, intervalFast: 1000 }]
                    });
                    await pub.connect(resp.watchId);
                    /* close({unpub}) releases the watch over REST and tears the
                     * socket down with no lingering timers. */
                    await pub.close({ unpub: true });
                    /* A second unpub of the now-released watch is an idempotent
                     * no-op for the owner (already gone). */
                    await pub.watchUnpub(resp.watchId).catch(() => { /* ok */ });
                    results.teardown = true;
                });

            it("step 8: controlSub round-trip — listener receives a pointWrite "
                + "command and settles it with reportWrite",
                async function () {
                    /* Register a standalone control listener for the bool point,
                     * connect it, then issue a pointWrite to that point. The
                     * command must reach the listener, which replies reportWrite;
                     * the pointWrite REST call then settles ok. */
                    const ctl = owner.createControlListener({
                        autoRecover: false
                    });
                    const commands = [];
                    ctl.on("command", (c) => commands.push(c));

                    try {
                        const sub = await ctl.controlSub({
                            data: [{ id: ids.bool }]
                        });
                        expect(sub.registrationId).to.be.a("string");
                        const boolEntry = (sub.data || []).find(
                            (d) => d.id === ids.bool);
                        expect(boolEntry, "bool registered").to.be.an("object");
                        expect(boolEntry.status).to.equal("registered");

                        await ctl.connect(sub.registrationId);

                        /* The listener replies reportWrite as soon as the command
                         * arrives, settling the request the pointWrite below
                         * waits on. */
                        ctl.on("command", (cmd) => {
                            const results2 = (cmd.data || []).map((d) => ({
                                id: d.id,
                                writeVal: d.value,
                                writeStatus: "ok"
                            }));
                            ctl.reportWrite(cmd.requestId, results2);
                        });

                        /* Issue the pointWrite (level 8, value true). It blocks
                         * until the listener settles it. */
                        const resp = await pointWrite(
                            owner, ids.bool, 8, true,
                            this.test.fullTitle());
                        expect(resp).to.have.keys("meta", "rows", "cols");

                        /* The listener observed the command. */
                        expect(commands.length).to.be.greaterThan(0);
                        const cmd = commands[0];
                        expect(cmd.command).to.equal("pointWrite");
                        expect(cmd.requestId).to.be.a("string");
                        const entry = (cmd.data || []).find(
                            (d) => d.id === ids.bool);
                        expect(entry, "command carried bool point")
                            .to.be.an("object");

                        results.controlRoundTrip = true;
                    }
                    finally {
                        await ctl.close({ unsub: true });
                    }
                });

            after(function () {
                /* Surface per-step pass map in the mocha output for the report. */
                // eslint-disable-next-line no-console
                console.log(
                    `    [pass ${pass}] step results: `
                    + JSON.stringify(results));
            });
        });
    });

    after("logout", async function () {
        /* Best-effort: shared per-user token; only log out the consumer client
         * if it owns a distinct token. Here both share the superuser token, so
         * leave logout to process exit. */
    });
});
