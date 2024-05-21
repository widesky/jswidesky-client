# Table of Contents
<!-- toc -->

- [Table of Contents](#table-of-contents)
  - [Client Options](#client-options)
    - [Path `client`](#path-client)
    - [Path `client.progress`](#path-clientprogress)
    - [Path `client.performOpInBatch`](#path-clientperformopinbatch)

<!-- tocstop -->

## Client Options
The argument `options` is expected to have the following structure:

| Path     | Description                                                                                                                                                                                     |  Type  |              Default              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------------------------------: |
| `axios`  | Axios client configurations as per [Axios documentation](https://axios-http.com/docs/config_defaults).                                                                                          | Object | As defined by the `axios` library |
| `http`   | Node HTTP agent configurations as per [Node.js documentation](https://nodejs.org/docs/latest-v16.x/api/http.html#new-agentoptions). This is used for HTTP(S) agents passed to the Axios client. | Object |               `{}`                |
| `client` | Object for defining `WideSkyClient` configurations.                                                                                                                                             | Object |                                   |

### Path `client`
The Object defined in `client` is expected to have the following structure:

| Path from `client` | Description                                                                                        |  Type  | Default |
| ------------------ | -------------------------------------------------------------------------------------------------- | :----: | :-----: |
| `impersonateAs`    | A WideSky user ID to impersonate requests as.                                                      | String | `null`  |
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

### Path `client.performOpInBatch`
The Object defined in `client.performOpInBatch` is expected to have the following structure:

| Path from `client.performOpInBatch` | Description                                                                |  Type   | Default |
| ----------------------------------- | -------------------------------------------------------------------------- | :-----: | :-----: |
| `batchSize`                         | Define the maximum size of each payload for an operation.                  | Number  |   100   |
| `batchDelay`                        | Define the time in between each batch request (ms).                        | Number  |    0    |
| `parallel`                          | Define the number of batched requests to be run in parallel                | Number  |    1    |
| `parallelDelay`                     | Define the delay between each set of batched requests run in parallel (ms) | Number  |    0    |
| `returnResult`                      | Enable the result from WideSky API server operation to be returned         | Boolean | `false` |
