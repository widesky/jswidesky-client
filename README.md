# JavaScript WideSky Client
This is a simple `Promise`-based client for the WideSky application server.

It can be used for both backend and frontend application.
See example code below on how to import it into your project. See the [API](https://github.com/widesky/jswidesky-client/blob/master/docs/client/api.md) 
documentation for the available functions.

# Table Of Contents
<!-- toc -->

- [Usages](#usages)
- [Installing it](#installing-it)
- [Importing it](#importing-it)
- [Creating an instance of the client](#creating-an-instance-of-the-client)
- [Performing an operation](#performing-an-operation)
- [Realtime publisher](#realtime-publisher)
- [WideSky query utilities](#widesky-query-utilities)
  - [Dynamic query](#dynamic-query)
  - [History groupBy interval](#history-groupby-interval)
- [Building the library](#building-the-library)
- [Running tests](#running-tests)
  - [Without coverage](#without-coverage)
  - [With coverage](#with-coverage)

<!-- tocstop -->

## Usages

The following section describes how the library can be used in both `nodejs` and `browser` context.
For the subsequent commands to work, we assume that you already have a running
`Widesky` instance ready to go.

## Installing it

You can install the WideSky client library by executing the command from your console.
```shell
npm install @widesky/jswidesky-client --save
```

## Importing it
The simplest way to incorporate the library into your browser is by using the `<script>` tag.

Example:
```html
<script src="https://unpkg.com/@widesky/jswidesky-client@3.2.0"></script>
<script>
  const WIDESKY_CONFIG = {
    "serverURL": "https://myWideSkyServer.com",
    "password": "abcdedfg",
    "username": "myUser@widesky.cloud",
    "clientId": "1231231231",
    "clientSecret": "545454545445"
  };
  const wsClient = JsWideSky.WideSkyClient.makeFromConfig(WIDESKY_CONFIG);
  wsClient.v2.find("site")
          .then((res) => console.log(res));
</script>
```

If this is for a sophisticated web application that is build on top of a framework that supports `es6`
then it can be added by using the `import` statement.

Example:
```javascript
import { WideSkyClient } from '@widesky/jswidesky-client';

const myClient = new WideSkyClient(
        "https://instanceName.on.widesky.cloud",
        "hello@widesky.cloud",
        "abcdefg",
        "client_id",
        "client_secret");
```

> For your debugging convenience, there is also a non minified version of the library, `wideskyClient.js`.

If this is for a NodeJS project then the following code may be used to import it.
```javascript
const jsWideSky = require('@widesky/jswidesky-client');
```

## Creating an instance of the client
An instance can be instantiated by using the `WideskyClient` constructor.

Example:
```javascript
const { WideSkyClient } = require('@widesky/jswidesky-client');

let myClient = new WideSkyClient(
                        server.url,
                        server.username,
                        server.password,
                        server.clientId,
                        server.secret);
```

### Outbound request pacing (opt-in)

By default, `jswidesky-client` dispatches HTTP requests to the apiserver as
fast as callers issue them. For high-throughput deployments — or
multi-tenant flows where the apiserver must be protected from bursty
clients — you can enable a per-client queue:

```javascript
const { WideSkyClient } = require('@widesky/jswidesky-client');

let myClient = new WideSkyClient(
    server.url,
    server.username,
    server.password,
    server.clientId,
    server.secret,
    null,    // logger
    null,    // accessToken
    {
        client: {
            queue: {
                maxConcurrent: 5,    // ≤5 in-flight requests at once
                minDelayMs:    50,   // ≥50ms between dispatches
                maxQueueDepth: 1000, // refuse-fast above this backlog
            },
        },
    }
);
```

| Option | Default | Meaning |
|---|---|---|
| `maxConcurrent` | 5 | Maximum number of in-flight HTTP requests at any moment |
| `minDelayMs` | 0 | Minimum gap between successive dispatches. Enforced via `setTimeout` — effective gap may be slightly larger under load due to Node timer drift. Not suitable as a hard rate budget. |
| `maxQueueDepth` | 1000 | Hard cap on queued (not-yet-in-flight) requests; over this, `add()` rejects with `QueueFullError` |
| `highWaterPct` | 0.8 | Fraction of `maxQueueDepth` at which a bunyan warn-log fires |
| `highWaterLogEveryN` | 50 | Throttle: log at most once per N enqueues past the high-water mark |

**Default off.** Omit the `queue` block (or pass `queue: undefined`) and the
SDK behaves identically to previous versions — no allocation, no overhead.

**Composes with batching.** `client.batch.create`, `client.batch.update`,
and friends chunk the payload first; the queue then paces the chunked
requests. The two layers are orthogonal and run together when both are
configured.

**One queue per `WideSkyClient` instance.** The queue is scoped to the
instance that owns it. If you want every caller in your process to share
a single throttle, reuse a single `WideSkyClient` instance (e.g. via a
shared factory or singleton). Multiple instances do **not** coordinate —
each gets its own independent queue.

**`QueueFullError`** is exported alongside the other client errors:

```javascript
const { clientErrors: { QueueFullError } } = require('@widesky/jswidesky-client');

try {
    await client.create(entity);
} catch (err) {
    if (err instanceof QueueFullError) {
        // back off, retry later, or surface to the caller
    }
}
```

## Performing an operation
Once an instance of the `WideskyClient` has been instantiated.
The client will automatically perform authentication and maintain the WideSky access token for you.
That is, you can start using it as soon as the instance is instantiated.

Querying for a list of points that are tagged with the `his` and `kind` tags, and looking up
their `fqname` virtual tag value.

```javascript
let myQuery = `{
  haystack {
    search(filter: "point and his and kind") {
      entity {
        id
        tags(tagFilter: "fqname") {
          value
        }
      }
    }
  }
}`;

let response = await myClient.query(myQuery);
```

See our [documentation](https://docs.widesky.cloud/reference/apis/cloud/graphql/) for more information
on the WideSky query language.

## Realtime publisher

An edge device can push current ("cur") values into WideSky in realtime over a
socket.io namespace using a publisher session. Create one with
`client.createPublisher()`, register a point set over REST with `watchPub()`,
open the socket with `connect()`, then emit `pointUpdate()` frames. The server
pushes `pointCadence` hints and `pointUpdateError` rejections back as events.

Cadence is watch-driven server-side: a point with a live consumer watch is "in
demand" and gets the fast cadence; with no watch it gets the slow cadence. The
publisher only sees the resulting `pointCadence` hints (`mode` is `"fast"` or
`"slow"`).

```javascript
const publisher = myClient.createPublisher();

// 1. Register the points to publish (REST). `shortRefs` lets you use compact
//    keys in subsequent pointUpdate frames to save cellular bandwidth.
//    intervalFast is the in-demand cadence; intervalSlow is the out-of-demand
//    cadence (0 = the publisher sleeps out of demand).
const { watchId } = await publisher.watchPub({
    onDisconnect: { mode: "grace", graceMs: 60000, curStatus: "down" },
    shortRefs: { "0": "r:pt-uuid-1", "1": "r:pt-uuid-2" },
    data: [
        { id: "pt-uuid-1", intervalFast: 1000, intervalSlow: 0 },
        { id: "pt-uuid-2", intervalFast: 5000, intervalSlow: 60000, curVal: 42.5 }
    ]
});

// 2. React to server-pushed events.
publisher.on("pointCadence", ({ data }) => {
    // data: [{ id: "0", mode: "fast" }, ...] — switch publishing cadence.
});
publisher.on("pointUpdateError", ({ err, errorCode }) => {
    // errorCode: 404 (namespace/ownership), 413 (frame too large),
    //            409 (watch superseded by a newer registration).
});
publisher.on("superseded", () => { /* 409: a newer registration took over */ });
publisher.on("reregister", ({ watchId }) => {
    // The namespace was found dead (post-grace); the session automatically
    // re-registered the same point set under a new watchId.
});

// 3. Open the socket (token handshake mirrors the consumer watch socket).
await publisher.connect(watchId);

// 4. Publish. Use full refs or the registered short refs. `ts` is optional.
publisher.pointUpdate([
    { id: "0", curVal: 42.7 },
    { id: "1", curStatus: "down", curErr: "PLC unreachable" }
]);

// Pass { his: true } to ALSO persist each value to history (in addition to the
// cur update). Omitted, a pointUpdate is cur-only and never historises.
publisher.pointUpdate([{ id: "0", curVal: 42.7 }], { his: true });

// 5. Clean shutdown (optionally release the watch over REST).
await publisher.close({ unpub: true });
```

A transient socket drop is healed by socket.io's own reconnection (a plain
namespace rejoin, no REST). If the server reports the namespace is gone (404
after the disconnect grace window has elapsed), the session automatically falls
back to a fresh `watchPub` of the same point set and re-opens the socket,
emitting a `reregister` event. Disable this with
`connect(watchId, { autoReregister: false })`.

## Realtime control listener

An edge can register as a control-command listener for a set of points: it
receives `pointWrite` commands and replies `reportWrite`, the same role a
privileged watcher used to provide. Create one with
`client.createControlListener()`, register the points over REST with
`controlSub()`, connect, handle `command` events and settle them with
`reportWrite()`. A control listener raises no publisher demand and receives no
point value data; it needs `POINT_WRITE` to receive a command and
`CONTROL_EXECUTE` to reply.

```javascript
const listener = myClient.createControlListener();

const { registrationId } = await listener.controlSub({
    data: [{ id: "pt-uuid-1" }, { id: "pt-uuid-2" }]
});

listener.on("command", (cmd) => {
    // cmd: { command: "pointWrite", requestId, data: [{ id, value }, ...] }
    const results = cmd.data.map((d) => ({
        id: d.id,
        writeVal: d.value,
        writeStatus: "ok"          // or "fail" + writeErr
    }));
    listener.reportWrite(cmd.requestId, results);
});

await listener.connect(registrationId);

// Clean shutdown (optionally release the registration over REST).
await listener.close({ unsub: true });
```

If the same account also runs a publisher session, the server can attach the
control registration to the publisher's existing socket (a "shared" transport):
its one socket then carries both `pointUpdate` and `pointWrite`/`reportWrite`
frames. Pass the owning publisher so the listener reuses that socket:

```javascript
const publisher = myClient.createPublisher();
await publisher.watchPub({ data: [{ id: "pt-uuid-1", intervalFast: 1000 }] });
await publisher.connect();

const listener = myClient.createControlListener({ publisher });
await listener.controlSub({ data: [{ id: "pt-uuid-1" }] });
await listener.connect();  // shared: reuses the publisher's socket, opens none
```

## Consumer watch lease renewal

A consumer watch (`watchSub` + `getWatchSocket`) has a finite lease.
`/api/watchPoll` renews that lease server-side as a side effect of polling, so a
polling consumer never needs to renew explicitly. A socket-style consumer that
never polls gets no special lease treatment, so its watch expires when the lease
lapses even while the socket stays connected. Keep it alive by re-issuing
`watchSub` with the watchId at half the lease, via `createWatchRenewer()`:

```javascript
const sub = await myClient.watchSub(pointIds, "n:120 sec", "my watch");
const watchId = sub.meta.watchId.substring(2);   // strip the "s:" prefix

const sock = myClient.getWatchSocket(watchId);
sock.on("pointData", (frame) => { /* ... */ });
sock.open();

const renewer = myClient.createWatchRenewer({
    watchId,
    pointIds,
    lease: "n:120 sec"
});
renewer.start();

// ... later ...
renewer.stop();
```

## WideSky query utilities

### Dynamic query
This library also include some of the commonly used
`widesky query` utilities that can used for helping
you to construct dynamic queries through the use of
`placeholder variables`.

One typical use-case for it is for example,
having a `widesky query` that dynamically always
look back 1 hour in time for data on a regular
basis.

In such scenario, the `$from` and `$to` variables
can be defined in the `history` node's `range` filter.

Example:

```javascript
let templateQuery = `{
  haystack {
    search(filter: "site", limit: 1) {
      entity {
        id
        search(filter: "equip", whereTag: "spaceRef", limit: 1) {
          entity {
            id
            findElec: search(filter: "point and elec", whereTag: "equipRef", limit: 2) {
              entity {
                id
                history(rangeAbsolute: {start: "${from}", end: "${to}"}) {
                  timeSeries {
                    dataPoints {
                      time
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// parseDt needs a timezone for `now…` expressions.
let myFrom = lib.graphql
                .exprParser
                .parseDt('now-1h', 'UTC');

let myTo = lib.graphql
              .exprParser
              .parseDt('now', 'UTC');

let query = lib.graphql
               .replace
               .timeVars(templateQuery, myFrom, myTo);

let resp = await myClient.graphql(query);
```

### History groupBy interval
A `history` read with no `groupBy` returns every stored sample, which over a
long range is megabytes of JSON for a chart that can draw a few hundred marks.
`lib.graphql.chooseInterval(range, options)` picks a `groupBy` bucket for a
time range, the same idea as Grafana's `$__interval`: it divides the range by a
target point count (default 400) and takes the first round step that fits from
1/5/15/30 min, 1/3/6/12 h, 1/2 d and 1/2/4 wk.

```javascript
const {chooseInterval, bucketsIn, replace, exprParser} = lib.graphql;

// ISO strings, epoch ms (number or digit string), Dates or now-… expressions.
// An ISO string without a Z or an offset is read in the host's local zone.
const range = {start: 'now-30d', end: 'now'};
const interval = chooseInterval(range);  // {groupByUnits: 'HOUR', groupBySize: 3}
console.log(`${bucketsIn(range, interval)} buckets`);  // about 240

// $__intervalDuration / $__intervalNum are the WideSky Grafana datasource's
// names, so the same template works in a Grafana panel and in an app.
// ($__intervalUnits / $__intervalSize are accepted as aliases.)
const template = `{
  haystack {
    search(filter: "point and his and kind==\\"Number\\"", limit: 10) {
      entity {
        id
        history(rangeAbsolute: {start: "$from", end: "$to"}) {
          aggregate(function: MEAN, allEntities: false, groupBy: {groupByUnits: $__intervalDuration, groupBySize: $__intervalNum, fill: NONE}) {
            timeSeries {
              dataPoints {
                time
                value
              }
            }
          }
        }
      }
    }
  }
}`;

// Pass one `now` to both ends so they share a single clock read.
const now = Date.now();
const from = exprParser.parseDt(range.start, 'UTC', now);
const to = exprParser.parseDt(range.end, 'UTC', now);
const query = replace.intervalVars(replace.timeVars(template, from, to), interval);
const resp = await myClient.graphql(query);
```

Notes:

- `options.minimum` (`'MINUTE'`, `'HOUR'`, `'DAY'`, `'WEEK'`, or an interval)
  sets the finest bucket, for callers that roll buckets up further themselves.
  For a monthly view, ask for `minimum: 'DAY'` and sum the days into months:
  the server's `duration` enum stops at `WEEK`, so this never returns a month.
  A `minimum` coarser than 4 weeks throws a `TypeError`.
- `options.targetPoints` changes the 400-point target. Buckets align to the
  epoch, so a range that doesn't start on a bucket boundary can come back with
  one bucket over the target. `bucketsIn` counts them the way the server cuts
  them.
- An empty, reversed, unparseable or `null` range still returns a bucket (the
  finest allowed), because the server rejects a `groupBy` without one. Past
  4 weeks × the target (about 30 years at 400 points), the result stays at
  4 weeks and the response has more points.
- With `fill: NONE`, a bucket finer than the data costs nothing: empty buckets
  are not returned.
- **For a total over the whole range, drop `groupBy` instead.** Don't use a
  single bucket the length of the range: buckets align to the epoch, not to the
  range start, so such a bucket splits the range and under-reports.

## Building the library
To build a release of the project, run;

```shell
npm run build
```

## Running tests

### Without coverage

```shell
$ npm run test
```

### With coverage

```shell
$ npm run coverage
```
