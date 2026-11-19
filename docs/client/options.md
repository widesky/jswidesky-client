# Table of Contents
<!-- toc -->

- [Table of Contents](#table-of-contents)
  - [Client Options](#client-options)
    - [Path `client`](#path-client)
    - [Path `client.progress`](#path-clientprogress)
    - [Path `client.performOpInBatch`](#path-clientperformopinbatch)
    - [Path `http`](#path-http)
    - [Path `http2`](#path-http2)
    - [Request timeout](#request-timeout)

<!-- tocstop -->

## Client Options
The argument `options` is expected to have the following structure:

| Path     | Description                                                                                                                                                                                          |  Type  |              Default              |
|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:------:|:---------------------------------:|
| `requestTimeout` | Maximum time in milliseconds to wait for any request (over HTTP/1.1 or HTTP/2, including the OAuth token request) before it fails with a `Request to <path> timed out after <ms>ms` error. Set to `0` to disable. A `timeout` passed in a single request's config overrides it for that request. See [Request timeout](#request-timeout). | Number | `60000` |
| `axios`  | Axios client configurations as per [Axios documentation](https://axios-http.com/docs/config_defaults). `axios.timeout` is honoured only when neither `requestTimeout` nor `http2.requestTimeout` is set. | Object | As defined by the `axios` library |
| `http`   | Node HTTP agent configurations as per [Node.js 16.x documentation](https://nodejs.org/docs/latest-v16.x/api/http.html#new-agentoptions). This is used for HTTP(S) agents passed to the Axios client. | Object |               `{}`                |
| `http2`  | HTTP 2 configurations as documented below.                                                                                                                                                           | Object |                                   |
| `client` | Object for defining `WideSkyClient` configurations.                                                                                                                                                  | Object |                                   |

### Path `client`
The Object defined in `client` is expected to have the following structure:

| Path from `client` | Description                                                                                        |  Type  | Default |
| ------------------ | -------------------------------------------------------------------------------------------------- | :----: | :-----: |
| `impersonateAs`    | A WideSky user **UUID**, or an account email, to impersonate requests as. Strings without `@` are validated as RFC 4122 UUIDs at construction (`TypeError` on miss). Empty / whitespace-only strings are rejected at construction. If an email is supplied, the lookup is deferred and runs as part of the first authenticated request (failure surfaces at that request, the email is retained so the next request retries, no result is cached across client instances). `unsetImpersonate()` and `impersonateAs(null)` both cancel a pending lookup. | String | `null`  |
| `progress`         | An Object defining live progress report configurations. Not used if `progress.enabled` is `false`. | Object | `false` |
| `performOpInBatch` | An Object defining default configurations for the function `performOpInBatch`                      | Object |         |
| `batch`            | An Object defining default configurations for various batch functions.                             | Object |         |

### Path `client.progress`
The Object defined in `client.progress` is expected to have the following structure:

| Path from `client.progress` | Description                                                                |  Type   | Default                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------- | :-----: | :--------------------------------------------------------------------------------------------------------------------------------- |
| `enable`                    | Enable progress reporting to the command interface.                        | Boolean | `false`                                                                                                                            |
| `instance`                  | Define the class instance to do progress reports.                          | Object  | `cliProgress.MultiBar({clearOnComplete: false, hideCursor: true}, cliProgress.Presets.shades_classic)` from package `cli-progress` |
| `increment`                 | A string that defines an increment function on `client.progress.instance`. | String  | "increment"                                                                                                                        |
| `create`                    | A string that defines a create function on `client.progress.instance`.     | String  | "create"                                                                                                                           |
| `update`                    | A string that defines a update function on `client.progress.instance`.     | String  | "update"                                                                                                                           |

Batch operations count requests: each creates one counter whose total is its number of requests, increments it as each
request completes (with `increment`, or `update` for a counter that has no `increment`), then stops it and calls
`remove` on `client.progress.instance` when it has one; with cli-progress, `remove` also clears the finished bar from
the terminal. A `progress` reporter given in the options of a batch call is used instead of this one; see
[Progress and logging](batch.md#progress-and-logging).

### Path `client.performOpInBatch`
The Object defined in `client.performOpInBatch` is expected to have the following structure:

| Path from `client.performOpInBatch` | Description                                                                |  Type   | Default |
| ----------------------------------- | -------------------------------------------------------------------------- | :-----: | :-----: |
| `batchSize`                         | Define the maximum size of each payload for an operation.                  | Number  |   100   |
| `batchDelay`                        | Define the time in between each batch request (ms).                        | Number  |    0    |
| `parallel`                          | Define the number of batched requests to be run in parallel                | Number  |    1    |
| `parallelDelay`                     | Define the delay between each set of batched requests run in parallel (ms) | Number  |    0    |
| `returnResult`                      | Enable the result from WideSky API server operation to be returned         | Boolean | `false` |
| `retries`                           | Define how many times a request is retried after a transient failure (HTTP 500, 502, 503, 504 or a network error). `0` disables retrying. Between 0 and 10. A retried `create` can create its entities twice if the first attempt succeeded but its response was lost. See [Retries](batch.md#retries). | Number  |    0    |
| `retryDelay`                        | Define the time to wait before each retry (ms). `0` means no delay.        | Number  |  2000   |


### Path `http`

Uses the standard Node.js [http.Agent](https://nodejs.org/docs/latest-v16.x/api/http.html#new-agentoptions) 
options to configure HTTP request behavior.

### Path `http2`
The Object defined in `http2` is expected to have the following structure:

| Path from `http2`  | Description                                                                                                                                                                                                                                          |  Type   | Default |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----: | :-----: |
| `enabled`          | Enables `http2` as a transport protocol. The server must support HTTP/2; otherwise, it will fall back to HTTP/1.1.                                                                                                                                   | Boolean | `false` |
| `requestTimeout`   | Deprecated alias of the top-level `requestTimeout`, used when that is not set. Despite its path it applies to every request, whether or not `enabled` is `true`. | Number  | `60000` |

### Request timeout
Every request the client makes is bounded by a timeout so that a stalled connection (for example a half-open TCP
flow whose far end has gone without sending a reset) fails the request instead of leaving it, and any request queued
behind it, pending forever. The effective value is the first of these that is set:

1. a `timeout` in the request's own config (per call),
2. `requestTimeout`,
3. `http2.requestTimeout` (alias),
4. `axios.timeout`,
5. the default, `60000` ms.

`0` disables the timeout. Over HTTP/1.1 axios applies it and closes the stalled connection; with `http2.enabled` the
client races each request against its own timer, since axios's timeout does not cover HTTP/2 session setup. Either way
the request fails with an error whose message is `Request to <path> timed out after <ms>ms`. The HTTP/1.1 error keeps
its axios `code` (`ECONNABORTED`, or `ETIMEDOUT` with `transitional.clarifyTimeoutError`), so batch operations with
`retries` treat it as a retryable network error.

The value in force is available read-only as `client.requestTimeout` (`0` when disabled). A request that legitimately
takes longer than the timeout (for example a very large `hisRead` over a slow link) needs a larger `requestTimeout`.

