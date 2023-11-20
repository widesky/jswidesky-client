
## Batch Operations Configuration
The `batch` property of the `options` argument used in `WideSkyClient` is expected to have the following structure:

| Path from `client.batch` | Description                                                 | Type   | Default                                                                   |
|--------------------------|-------------------------------------------------------------|--------|---------------------------------------------------------------------------|
| `hisRead`                | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.hisRead`             |
| `hisWrite`               | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.hisWrite`            |
| `hisDelete`              | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.hisDelete`           |
| `create`                 | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.create`              |
| `update`                 | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.update`              |
| `deleteById`             | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.deleteById`          |
| `deleteByFilter`         | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.deleteByFilter`      |
| `hisReadByFilter`        | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.hisReadByFilter`     |
| `addChildrenByFilter`    | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.addChildrenByFilter` |
| `updateByFilter`         | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.updateByFilter`      |
| `migrateHistory`         | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.migrateHistory`      |
| `hisDeleteByFilter`      | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.hisDeleteByFilter`   |
| `updateOrCreate`         | Define the default batch configurations for this functions. | Object | As per the table of configurations for `client.batch.updateOrCreate`      |

### Path `client.batch.hisRead`
The Object in `client.batch.hisRead` is expected to have the following structure:

| Path from `client.batch.hisRead` | Description                                                                  | Type    | Default |
|----------------------------------|------------------------------------------------------------------------------|---------|---------|
| `batchSize`                      | Define the maximum size of each payload for `hisRead` operations.            | Number  | 100     |
| `batchDelay`                     | Define the time in between each batch `hisRead` request (ms).                | Number  | 0       |
| `parallel`                       | Define the number of batched requests to be run in parallel                  | Number  | 1       |
| `parallelDelay`                  | Define the delay between each set of batched requests run in parallel (ms)   | Number  | 0       |

### Path `client.batch.hisWrite`
The Object in `client.batch.hisWrite` is expected to have the following structure:

| Path from `client.batch.hisWrite` | Description                                                                   | Type    | Default |
|-----------------------------------|-------------------------------------------------------------------------------|---------|---------|
| `batchSize`                       | Define the maximum number of rows of each payload for `hisWrite` operations.  | Number  | 2000    |
| `batchDelay`                      | Define the time in between each batch `hisWrite` request (ms).                | Number  | 0       |
| `parallel`                        | Define the number of batched requests to be run in parallel                   | Number  | 1       |
| `parallelDelay`                   | Define the delay between each set of batched requests run in parallel (ms)    | Number  | 0       |
| `returnResult`                    | Enable the result from WideSky API server operation `hisWrite` to be returned | Boolean | `false` |

### Path `client.batch.hisDelete`
The Object in `client.batch.hisDelete` is expected to have the following structure:

| Path from `client.batch.hisDelete` | Description                                                                                                         | Type    | Default |
|------------------------------------|---------------------------------------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                        | Define the maximum number of time series data to be deleted across all entities in a single `hisDelete` operations. | Number  | 100     |
| `batchSizeEntity`                  | Define the maximum number of entities to perform a `hisDelete` operation on.                                        |         |         |
| `batchDelay`                       | Define the time in between each batch `hisDelete` request (ms).                                                     | Number  | 0       |
| `parallel`                         | Define the number of batched requests to be run in parallel                                                         | Number  | 1       |
| `parallelDelay`                    | Define the delay between each set of batched requests run in parallel (ms)                                          | Number  | 0       |
| `returnResult`                     | Enable the result from WideSky API server operation `hisDelete` to be returned                                      | Boolean | `false` |

### Path `client.batch.create`
The Object in `client.batch.create` is expected to have the following structure:

| Path from `client.batch.create` | Description                                                                 | Type    | Default |
|---------------------------------|-----------------------------------------------------------------------------|---------|---------|
| `batchSize`                     | Define the maximum size of each payload for `create` operations.            | Number  | 2000    |
| `batchDelay`                    | Define the time in between each batch `create` request (ms).                | Number  | 0       |
| `parallel`                      | Define the number of batched requests to be run in parallel                 | Number  | 1       |
| `parallelDelay`                 | Define the delay between each set of batched requests run in parallel (ms)  | Number  | 0       |
| `returnResult`                  | Enable the result from WideSky API server operation `create` to be returned | Boolean | `false` |

### Path `client.batch.update`
The Object in `client.batch.update` is expected to have the following structure:

| Path from `client.batch.update` | Description                                                                 | Type    | Default |
|---------------------------------|-----------------------------------------------------------------------------|---------|---------|
| `batchSize`                     | Define the maximum size of each payload for `update` operations.            | Number  | 2000    |
| `batchDelay`                    | Define the time in between each batch `update` request (ms).                | Number  | 0       |
| `parallel`                      | Define the number of batched requests to be run in parallel                 | Number  | 1       |
| `parallelDelay`                 | Define the delay between each set of batched requests run in parallel (ms)  | Number  | 0       |
| `returnResult`                  | Enable the result from WideSky API server operation `update` to be returned | Boolean | `false` |

### Path `client.batch.deleteById`
The Object in `client.batch.deleteById` is expected to have the following structure:

| Path from `client.batch.deleteById` | Description                                                                     | Type    | Default |
|-------------------------------------|---------------------------------------------------------------------------------|---------|---------|
| `batchSize`                         | Define the maximum size of each payload for `deleteById` operations.            | Number  | 30      |
| `batchDelay`                        | Define the time in between each batch `deleteById` request (ms).                | Number  | 0       |
| `parallel`                          | Define the number of batched requests to be run in parallel                     | Number  | 1       |
| `parallelDelay`                     | Define the delay between each set of batched requests run in parallel (ms)      | Number  | 0       |
| `returnResult`                      | Enable the result from WideSky API server operation `deleteById` to be returned | Boolean | `false` |

### Path `client.batch.deleteByFilter`
The Object in `client.batch.deleteByFilter` is expected to have the following structure:

| Path from `client.batch.deleteByFilter` | Description                                                                         | Type    | Default |
|-----------------------------------------|-------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                             | Define the maximum size of each payload for `deleteByFilter` operations.            | Number  | 30      |
| `batchDelay`                            | Define the time in between each batch `deleteByFilter` request (ms).                | Number  | 0       |
| `parallel`                              | Define the number of batched requests to be run in parallel                         | Number  | 1       |
| `parallelDelay`                         | Define the delay between each set of batched requests run in parallel (ms)          | Number  | 0       |
| `returnResult`                          | Enable the result from WideSky API server operation `deleteByFilter` to be returned | Boolean | `false` |

### Path `client.batch.hisReadByFilter`
The Object in `client.batch.hisReadByFilter` is expected to have the following structure:

| Path from `client.batch.hisReadByFilter` | Description                                                                          | Type    | Default |
|------------------------------------------|--------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                              | Define the maximum size of each payload for `hisReadByFilter` operations.            | Number  | 100     |
| `batchDelay`                             | Define the time in between each batch `hisReadByFilter` request (ms).                | Number  | 0       |
| `parallel`                               | Define the number of batched requests to be run in parallel                          | Number  | 1       |
| `parallelDelay`                          | Define the delay between each set of batched requests run in parallel (ms)           | Number  | 0       |
| `returnResult`                           | Enable the result from WideSky API server operation `hisReadByFilter` to be returned | Boolean | `false` |
| `filter`                                 | Define the maximum number of entities to be returned. 0 means no limit.              | Number  | 0       |

### Path `client.batch.addChildrenByFilter`
The Object in `client.batch.addChildrenByFilter` is expected to have the following structure:

| Path from `client.batch.addChildrenByFilter` | Description                                                                              | Type    | Default |
|----------------------------------------------|------------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                                  | Define the maximum size of each payload for `addChildrenByFilter` operations.            | Number  | 2000    |
| `batchDelay`                                 | Define the time in between each batch `addChildrenByFilter` request (ms).                | Number  | 0       |
| `parallel`                                   | Define the number of batched requests to be run in parallel                              | Number  | 1       |
| `parallelDelay`                              | Define the delay between each set of batched requests run in parallel (ms)               | Number  | 0       |
| `returnResult`                               | Enable the result from WideSky API server operation `addChildrenByFilter` to be returned | Boolean | `false` |
| `filter`                                     | Define the maximum number of entities to be returned. 0 means no limit.                  | Number  | 0       |

### Path `client.batch.updateByFilter`
The Object in `client.batch.updateByFilter` is expected to have the following structure:

| Path from `client.batch.updateByFilter` | Description                                                                         | Type    | Default |
|-----------------------------------------|-------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                             | Define the maximum size of each payload for `updateByFilter` operations.            | Number  | 2000    |
| `batchDelay`                            | Define the time in between each batch `updateByFilter` request (ms).                | Number  | 0       |
| `parallel`                              | Define the number of batched requests to be run in parallel                         | Number  | 1       |
| `parallelDelay`                         | Define the delay between each set of batched requests run in parallel (ms)          | Number  | 0       |
| `returnResult`                          | Enable the result from WideSky API server operation `updateByFilter` to be returned | Boolean | `false` |
| `filter`                                | Define the maximum number of entities to be returned. 0 means no limit.             | Number  | 0       |

### Path `client.batch.migrateHistory`
The Object in `client.batch.migrateHistory` is expected to have the following structure:

| Path from `client.batch.migrateHistory` | Description                                                                         | Type    | Default |
|-----------------------------------------|-------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                             | Define the maximum size of each payload for `migrateHistory` operations.            | Number  | 2000    |
| `batchDelay`                            | Define the time in between each batch `migrateHistory` request (ms).                | Number  | 0       |
| `parallel`                              | Define the number of batched requests to be run in parallel                         | Number  | 1       |
| `parallelDelay`                         | Define the delay between each set of batched requests run in parallel (ms)          | Number  | 0       |
| `returnResult`                          | Enable the result from WideSky API server operation `migrateHistory` to be returned | Boolean | `false` |

### Path `client.batch.hisDeleteByFilter`
The Object in `client.batch.hisDeleteByFilter` is expected to have the following structure:

| Path from `client.batch.hisDeleteByFilter` | Description                                                                            | Type    | Default |
|--------------------------------------------|----------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                                | Define the maximum size of each payload for `hisDeleteByFilter` operations.            | Number  | 100     |
| `batchDelay`                               | Define the time in between each batch `hisDeleteByFilter` request (ms).                | Number  | 0       |
| `parallel`                                 | Define the number of batched requests to be run in parallel                            | Number  | 1       |
| `parallelDelay`                            | Define the delay between each set of batched requests run in parallel (ms)             | Number  | 0       |
| `returnResult`                             | Enable the result from WideSky API server operation `hisDeleteByFilter` to be returned | Boolean | `false` |
| `filter`                                   | Define the maximum number of entities to be returned. 0 means no limit.                | Number  | 0       |

### Path `client.batch.updateOrCreate`
The Object in `client.batch.updateOrCreate` is expected to have the following structure:

| Path from `client.batch.updateOrCreate` | Description                                                                             | Type    | Default |
|-----------------------------------------|-----------------------------------------------------------------------------------------|---------|---------|
| `batchSize`                             | Define the maximum size of each payload for `update` or `create` operations.            | Number  | 2000    |
| `batchDelay`                            | Define the time in between each batch `update` or `reate` request (ms).                 | Number  | 0       |
| `parallel`                              | Define the number of batched requests to be run in parallel                             | Number  | 1       |
| `parallelDelay`                         | Define the delay between each set of batched requests run in parallel (ms)              | Number  | 0       |
| `returnResult`                          | Enable the result from WideSky API server operation `update` or `create` to be returned | Boolean | `true`  |

### Path `client.batch.multiFind`
The Object in `client.batch.multiFind` is expected to have the following structure:

| Path from `client.batch.multiFind` | Description                                                                | Type   | Default |
|------------------------------------|----------------------------------------------------------------------------|--------|---------|
| `batchSize`                        | Define the maximum size of each payload for `multiFind` operations.        | Number | 2000    |
| `batchDelay`                       | Define the time in between each batch `multiFind` request (ms).            | Number | 0       |
| `parallel`                         | Define the number of batched requests to be run in parallel                | Number | 1       |
| `parallelDelay`                    | Define the delay between each set of batched requests run in parallel (ms) | Number | 0       |
| `filter`                           | Define the maximum number of entities to be returned. 0 means no limit.    | Number | 0       |
