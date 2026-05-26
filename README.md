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
- [WideSky query utilities](#widesky-query-utilities)
  - [Dynamic query](#dynamic-query)
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
                perToken:      true, // share bucket across SDK instances
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
| `perToken` | false | If true, share the queue across all `WideSkyClient` instances with the same `(serverURL, username, clientId)` login identity within the same Node.js process |
| `highWaterPct` | 0.8 | Fraction of `maxQueueDepth` at which a bunyan warn-log fires |
| `highWaterLogEveryN` | 50 | Throttle: log at most once per N enqueues past the high-water mark |

**Default off.** Omit the `queue` block (or pass `queue: undefined`) and the
SDK behaves identically to previous versions — no allocation, no overhead.

**Composes with batching.** `client.batch.create`, `client.batch.update`,
and friends chunk the payload first; the queue then paces the chunked
requests. The two layers are orthogonal and run together when both are
configured.

**Client lifecycle assumption.** This SDK is designed for the **long-lived
client** pattern — construct one `WideSkyClient` per login at process start
and reuse it for every operation. With `perToken: true`, the shared queue
for each `(serverURL, username, clientId)` triple is retained in a
process-wide registry for the **lifetime of the process**. If your
application creates short-lived `WideSkyClient` instances (e.g. a new
instance per HTTP request in a multi-tenant server), do **not** enable
`perToken: true` — the registry has no eviction and will retain one
`RequestQueue` per unique login indefinitely. A `dispose()` lifecycle for
ephemeral-client usage is not in scope for the current implementation.

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

let myFrom = lib.graphql
                .exprParser
                .parseDt('now-1h');

let myTo = lib.graphql
              .exprParser
              .parseDt('now');

let query = lib.graphql
               .replace
               .timeVars(templateQuery, myFrom, myTo);

let resp = await myClient.graphql(query);
```

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
