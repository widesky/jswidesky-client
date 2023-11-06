
## Client Options
The argument `options` is expected to have the following structure:

| Path     | Description                                                                    | Type   | Default                           |
|----------|--------------------------------------------------------------------------------|--------|-----------------------------------|
| `axios`  | Axios client configurations as per https://axios-http.com/docs/config_defaults | Object | As defined by the `axios` library |
| `client` | Object for defining `WideSkyClient` configurations.                            | Object |                                   |

### Path `client`
The Object defined in `client` is expected to have the following structure:

| Path from `client` | Description                                                                                       | Type    | Default |
|--------------------|---------------------------------------------------------------------------------------------------|---------|---------|
| `impersonateAs`    | A WideSky user ID to impersonate requests as.                                                     | String  | `null`  |
| `progress`         | A Object defining live progress report configurations. Not used if `progress.enabled` is `false`. | Boolean | `false` |
| `performOpInBatch` | A Object defining default configurations for the function `performOpInBatch`                      | Object  |         |
| `batch`            | A Object defining default configurations for various batch functions.                             | Object  |         |

### Path `client.progress`
The Object defined in `client.progress` is expected to have the following structure:

| Path from `client.progress` | Description                                                                | Type    | Default                                                                                                                            |
|-----------------------------|----------------------------------------------------------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------|
| `enabled`                   | Enable progress reporting to the command interface.                        | Boolean | `false`                                                                                                                            |
| `instance`                  | Define the class instance to do progress reports.                          | Object  | `cliProgress.MultiBar({clearOnComplete: false, hideCursor: true}, cliProgress.Presets.shades_classic)` from package `cli-progress` |
| `increment`                 | A string that defines an increment function on `client.progress.instance`. | String  |                                                                                                                                    |
| `create`                    | A string that defines a create function on `client.progress.instance`.     | String  | "increment"                                                                                                                        |
|                             |                                                                            | String  | "create"                                                                                                                           |

### Path `client.performOpInBatch`
The Object defined in `client.performOpInBatch` is expected to have the following structure:

| Path from `client.performOpInBatch` | Description                                                                | Type    | Default |
|-------------------------------------|----------------------------------------------------------------------------|---------|---------|
| `batchSize`                         | Define the maximum size of each payload for an operation.                  | Number  | 100     |
| `batchDelay`                        | Define the time in between each batch request (ms).                        | Number  | 0       |
| `parallel`                          | Define the number of batched requests to be run in parallel                | Number  | 1       |
| `parallelDelay`                     | Define the delay between each set of batched requests run in parallel (ms) | Number  | 0       |
| `returnResult`                      | Enable the result from WideSky API server operation to be returned         | Boolean | `false` |