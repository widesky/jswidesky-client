# Performing an operation
Once an instance of the `WideskyClient` has been instantiated, the client will automatically perform authentication
and maintain the WideSky access token for you. This allows the client to be used as the instance has been
instantiated. The available operations are divided into 3 sets:
- WideSky functions
- Haystack functions
- Class specific functions
- Version 2 functions, an iteration of the Haystack functions
- Batch function that implement the above function by batching the given payload

The operations are described below:

## WideSky Functions
A list of functions available on the `WideSkyClient` class that perform WideSky specific operations.

### WideSkyClient.login()
**Description:** Perform a login using the configured WideSky credentials for the client instance if not already logged
in.  
**Parameters:** None  
**Returns:** `Promise<{access_token: String, refreshToken: String, expires_in: Number, token_type: String}>` - A token
object.


### WideSkyClient.query(graphql)
**Description:** Perform a GraphQL request to the WideSky API server.  
**Parameters:**

| Param     | Description        | Type   |
|-----------|--------------------|--------|
| `graphql` | The GraphQL query. | String |

**Returns:** `Promise<RawGrid>`- GraphQL response.

### WideSkyClient.createUser(email, name, description, roles, password, method)
**Description:** Create a new WideSky user.  
**Parameters:**

| Param         | Description                                                                                                                                                                 | Type     | Default |
|---------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------|
| `email`       | Email or username of the new user.                                                                                                                                          | String   |         |
| `name`        | Name or description of the new user account. This will be assigned to the `dis` field of the User entity.                                                                   | String   |         |
| `description` | Purpose of the user account. E.g. "User", "SuperUser", etc.                                                                                                                 | String   |         |
| `roles`       | The IDs (UUIDs or names) of the Role entities to link to this new user.                                                                                                     | String[] |         |
| `password`    | The new password for the user. If set to `null` or the empty String, the user will be sent an email to activate their user account.                                         | String?  | `null`  |
| `method`      | The authentication method for the new user. At the time of writing, the choices are: "local" (the default, using OAuth2 authentication) and "scram" (SCRAM authentication). | String?  | "local" |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.updatePassword(newPassword)
**Description:** Change the current session user's password.  
**Parameters:**

| Param         | Description                     | Type   |
|---------------|---------------------------------|--------|
| `newPassword` | The new password to be applied. | String |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.fileUpload(ids, ts, filename, mediaType, inlineRetrieval, cacheMaxAge, force, tags)
**Description:** Upload a file to the WideSky server.  
**Parameters:**

| Param             | Description                                                                                                                                                                                          | Type             | Default |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------|---------|
| `id`              | Identifier of the object point.                                                                                                                                                                      | String           |         |
| `ts`              | Timestamp which the upload will perform against the object point.                                                                                                                                    | String           |         |
| `file`            | The upload target, this can either be an absolute file path or a buffer.                                                                                                                             | String or Buffer |         |
| `filename`        | Name of the upload.                                                                                                                                                                                  | String           |         |
| `mediaType`       | Media type of the upload. (e.g. pdf = application/pdf)                                                                                                                                               | String           |         |
| `inlineRetrieval` | When `true`, client that supports the HTTP header contentDisposition will render the uploaded file on the screen instead of presenting the 'Save as' dialog. If nothing is set then true is assumed. | Boolean          | `true`  |
| `cacheMaxAge`     | The number of seconds a client, that supports the HTTP header CacheMaxAge, should store the retrieved file (stored in this op) in cache before re-downloading it again.                              | Number           | `1800`  |
| `force`           | When `true`, the server will forcefully overwrite a previously stored file that shares the same given ts. Default is false.                                                                          | Boolean          | `false` |
| `tags`            | An object consisting of additional file tags that will go with the upload. Key of the object is the tagName while value is its tagValue. E.g. `{ 'UploadedBy': 'AuthorABC'}`                         | Tags             | `{}`    |

**Returns:** `Promise<{success: Boolean}>` - A response indicating if the upload was successful or not.

### WideSkyClient.fileRetrieve(pointIds, from, to, presigned, presignExpiry)
**Description:** Retrieve a previously stored file the configured WideSky server. This API will return an object keyed
by the requested point ids, where the value is an array of file URLs which can be used to retrieve the file data via
the HTTP GET method.

Date inputs for this function is the standard ISO8601 dates. For example:
- 2022-03-30T11:30:00Z
- 2022-07-26T11:00:00+02:00

**Parameters:**

| Param           | Description                                                 | Type            | Default |
|-----------------|-------------------------------------------------------------|-----------------|---------|
| `pointIds`      | A single or multiple point identifiers, who have kind=File. | String or Array |         |
| `from`          | Starting ISO8601 timestamp of the retrieve.                 | Date            |         |
| `to`            | Ending ISO8601 timestamp of the retrieve.                   | Date            |         |
| `presigned`     | Flag for indicating if the returned URL should be resigned. | Boolean         | `true`  |
| `presignExpiry` | Duration in seconds where the presigned link will expire.   | Number          | `1800`  |

**Returns:** `Promise<Array<{pointId: String, urls: Array<{time: Number, value: String}>>>`

### WideSkyClient.entityCount(filter)
**Description:** Get the number of entities to be returned from a filter.  
**Parameters:**

| Param    | Description                | Type   |
|----------|----------------------------|--------|
| `filter` | Filter to select entities. | String |

**Returns:** `Promise<Number>` - Number of entities found.

### WideSkyClient.findAsId(filter, limit)
**Description:** Perform a read by filter but only return the IDs of the entities found.  
**Parameters:**

| Param    | Description                                                             | Type   | Default |
|----------|-------------------------------------------------------------------------|--------|---------|
| `filter` | Filter to select entities.                                              | String |         |
| `limit`  | Limit to be imposed on the number of entities found using the `filter`. | Number | 0       |

**Returns:** `Promise<Array<String>>` - Array of Ids of the entities found.

### WideSkyClient.impersonateAs(userId)
**Description:** Impersonate as a WideSky user when performing requests.  
**Parameters:**

| Param    | Description                                     | Type   |
|----------|-------------------------------------------------|--------|
| `userId` | The UUID of the User entity to be impersonated. | String |

**Returns:** None

### WideSkyClient.submitRequest(method, uri, body, config)
**Description:** Submit a request manually to the WideSky server.  
**Parameters:**

| Param    | Description                                                                                    | Type   | Default |
|----------|------------------------------------------------------------------------------------------------|--------|---------|
| `method` | Request method to be performed.                                                                | String |         |
| `uri`    | Sub URI from the configured `baseUri` of the `WideSkyClient` instance to issue the request to. | String |         |
| `body`   | Body of the request.                                                                           | Object | `{}`    |
| `config` | Configurations for the request, as specified for `axios`.                                      | Object | `{}`    |

**Returns:** Response from the request.

### WideSkyClient.setAcceptGzip(acceptGzip)
**Description:** Configure the responses from requests to specify GZip encoding.  
**Parameters:**

| Param        | Description                      | Type    |
|--------------|----------------------------------|---------|
| `acceptGzip` | Enable or disable GZip encoding. | Boolean |

**Returns:** None

## Haystack Functions
A list of Haystack functions that follow the Haystack Project specification.

### WideSkyClient.read(ids)
**Description:** Perform a `read` request of the WideSky API server.  
**Parameters:**

| Param | Description               | Type            |
|-------|---------------------------|-----------------|
| `ids` | Entity IDs to search for. | String or Array |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.find(filter, limit)
**Description:** Perform a `read` request of the WideSky API server using a filter to refine the selection.  
**Parameters:**

| Param    | Description                                     | Type   | Default |
|----------|-------------------------------------------------|--------|---------|
| `filter` | Filter expression                               | String |         |
| `limit`  | Limit on the number of entities to be returned. | Number | 0       |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.create(entities)
**Description:** Create one or more entities.  
**Parameters:**

| Param      | Description                            | Type   |
|------------|----------------------------------------|--------|
| `entities` | Array of entity Objects to be created. | Object |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.update(entities)
**Description:** Update one or more entities.  
**Parameters:**

| Param      | Description                            | Type   |
|------------|----------------------------------------|--------|
| `entities` | Array of entity Objects to be updated. | Object |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.deleteBYId(ids)
**Description:** Delete one or more entities given as IDs.  
**Parameters:**

| Param | Description               | Type            |
|-------|---------------------------|-----------------|
| `ids` | Entity IDs to be deleted. | String or Array |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.deleteByFilter(filter, limit)
**Description:** Delete entities that match a given filter expression.  
**Parameters:**

| Param    | Description                                       | Type   | Default |
|----------|---------------------------------------------------|--------|---------|
| `filter` | Filter expression to select entities for removal. | String |         |
| `limit`  | Limit on the number of entities to be deleted.    | Number | 0       |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.hisRead(ids, from, to, batchSize)
**Description:** Perform a historical read of the entity `ids` given.  
**Parameters:**

| Param       | Description                                                                                                 | Type            | Default |
|-------------|-------------------------------------------------------------------------------------------------------------|-----------------|---------|
| `ids`       | Entity or entities to be read.                                                                              | String or Array |         |
| `from`      | A textual Haystack read range or a Date Object representing the starting time stamp of the read.            | String or Date  |         |
| `to`        | A textual Haystack read range or a Date Object representing the ending time stamp of the read.              | String Or Date  |         |
| `batchSize` | Set the number of `ids` to be read to be batched per request sent. These requests will be sent in parallel. | Number          | 50      |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.hisWrite(records)
**Description:** Perform a historical write request.  
**Parameters:**

| Param     | Description                                                                                                         | Type   |
|-----------|---------------------------------------------------------------------------------------------------------------------|--------|
| `records` | Records to be written keyed by time stamp. Each record should map the point's ID to its value for that time record. | Object |

A `record` Object is expected to be structured as:
```json
{
  "t:<haystackTimeString>": {
    "r:<pointID>": "<haystackValueToBeWritten>",
    ...
  },
  ...
}
```

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.watchSub(pointsIds, lease, description, config)
**Description:** Initiate a Haystack WatchSub operation based on the given list of `pointIds`.  
**Parameters:**

| Param         | Description                                      | Type            | Default |
|---------------|--------------------------------------------------|-----------------|---------|
| `pointIds`    | The point Ids to perform watchSub on.            | String or Array |         |
| `lease`       | Duration (ms) the watch will exist,              | String          |         |
| `description` | A short description for the watch session.       | String          |         |
| `config`      | Configuration options used in `submitRequest()`, | Object          | `{}`    |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.watchExtend(watchId, pointIds, lease, config)
**Description:** Initiate a haystack watchSub op to extend a watch given the watchId and lease.  
**Parameters:**

| Param      | Description                                      | Type            | Default |
|------------|--------------------------------------------------|-----------------|---------|
| `watchId`  | The ID of the opened watch.                      | String or Array |         |
| `pointIds` | The point Ids to perform watchExtension on.      | String          |         |
| `lease`    | Duration (ms) the watch will exist.              | String          |         |
| `config`   | Configuration options used in `submitRequest()`, | Object          | `{}`    |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.watchUnsub(watchId, deletePointIds, close, config)
**Description:** Initiate a watchUnsub op using the given watchId. If deletePointIds is set, then the listed points
will be removed from the watch.
**Parameters:**

| Param            | Description                                     | Type            | Default |
|------------------|-------------------------------------------------|-----------------|---------|
| `watchId`        | ID of the opened watch.                         | String          |         |
| `deletePointIds` | The point entities to be deleted.               | String or Array |         |
| `close`          | If `true`, the watch session will be closed.    | Boolean         | `true`  |
| `config`         | Configuration options used in `submitRequest()` | Object          | `{}`    |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

### WideSkyClient.getWatchSocket(watchId)
**Description:** Initiate a watch socket object given a valid watch ID string.  
**Parameters:**

| Param     | Description   | Type   |
|-----------|---------------|--------|
| `watchId` | The Watch ID. | String |

**Returns:** `Promise<Socket>` - A socket.io Socket object.

### WideSkyClient.hisDelete(ids, range)
**Description:** Perform a history delete request.  
**Parameters:**

| Param   | Description                                                             | Type            |
|---------|-------------------------------------------------------------------------|-----------------|
| `ids`   | A single or Array of Point IDs to be delete historical data from.       | String or Array |
| `range` | A valid hisRead range string. Note that the end range is not inclusive. | String          |

**Returns:** `Promise<RawGrid>` - A response that resolved to the raw grid.

## Version 2 Functions
A list of functions that modify the response of the Haystack functions to be more suitable for machine consumption.

### WideSkyClient.v2.find(filter, limit)
**Description:** Perform a `WideSkyClient.find` operation but only return the rows from the Haystack grid.  
**Parameters:**

| Param    | Description                                     | Type   | Default |
|----------|-------------------------------------------------|--------|---------|
| `filter` | Filter expression                               | String |         |
| `limit`  | Limit on the number of entities to be returned. | Number | 0       |

**Returns:** `Array<Entity>` - A Array of found entities from the filter expression.

## Batch Functions
A list of functions that use the base functions of `WideSkyClient` but with batch functionality incorporated. The
functions can be used to complete a requested operation whilst working within the limitation imposed by the WideSky
server.

### WideSkyClient.performOpInBatch(op, args, options)
**Description:** Perform a `WideSkyClient` operation using batch functionality to issue batched payloads in parallel
requests.  
**Parameters:**

| Param     | Description                                                                                                                                        | Type   | Default |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------|--------|---------|
| `op`      | `WideSkyClient` function to be called.                                                                                                             | String |         |
| `args`    | Arguments or parameters to be passed to the given `op`.                                                                                            | Array  |         |
| `options` | Options to configure the behaviour of the batched functionality. See [batch options](options.md#path-clientperformopinbatch) for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{error: String, args: []}>}>`
- `success`: Contain the responses of successful operations when `options.returnResult` is `true`.
- `errors`: Contain an errors encountered when performing operations.

### WideSkyClient.batch.hisWrite(hisWriteData, options)
**Description:** Perform a hisWrite operation using batch functionality.  
**Parameters:**

| Param          | Description                                                                                                                                                                                                                          | Type                      | Default |
|----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------|---------|
| `hisWriteData` | HisWrite data to be sent. Can be the raw hisWrite payload or an instance of HisWritePayload.                                                                                                                                         | Object or HisWritePayload |         |
| `options`      | A Object defining batch configurations to be used. See README.md for more information. Option batchSize is determined by the maximum number of time series rows to be sent. The rows are defined as the time series for each entity. | Object                    | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Contain the responses of successful operations of hisWrite when `options.returnResult` is `true`.
- `errors`: Contain an errors encountered when performing operations.

### WideSkyClient.batch.hisRead(ids, from, to, options)
**Description:** Perform a history read request using batch functionality.  
**Parameters:**

| Param     | Description                                                                                                                                                          | Type           | Default |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|---------|
| `ids`     | Entities to read.                                                                                                                                                    | Array          |         |
| `from`    | Haystack read range or a Date Object representing where to grab historical data from.                                                                                | String or Date |         |
| `to`      | Date Object representing where to grab historical data to (not inclusive).                                                                                           | String or Date |         |
| `options` | A Object defining batch configurations to be used. See README.md for more information. Option batchSize is determined by the number of ids to perform a hisRead for. | Object         | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: A 2D array of time series data in the order of ids queried.
- `errors`: Contain an errors encountered when performing operations.

### WideSkyClient.batch.hisDelete(ids, start, end, options)
**Description:** Perform a history delete request using batch functionality. A hisRead will be performed for the ids
and range given to determine how the hisDelete ranges should be split to have at most options.batchSize time series
rows deleted. The option batchSizeEntity will also impact the number of entities involved when performing a hisRead
operation.  
**Parameters:**

| Param     | Description                                                                                                                                                                                         | Type | Default |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------|---------|
| `ids`     | An array of point entity UUIDs for the delete operations or a single string. These will be batched by options.batchSizeEntity.                                                                      |      |         |
| `start`   | Starting timestamp to be deleted as a Date Object.                                                                                                                                                  |      |         |
| `end`     | Ending timestamp to be deleted as a Data Object (not inclusive).                                                                                                                                    |      |         |
| `options` | A Object defining batch configurations to be used. See README.md for more information. Option batchSize is determined by the maximum number of time series rows to be deleted across all ids given. |      |         |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the responses of hisDelete operations if `options.returnResult` is `true`.
- `errors`: Return the errors encountered from hisDelete operations.

### WideSkyClient.batch.create(entities, options)
**Description:** Perform a create request using batch functionality. The request are batched based on the number of
entities given.  
**Parameters:**

| Param      | Description                                                                            | Type   | Default |
|------------|----------------------------------------------------------------------------------------|--------|---------|
| `entities` | Entities to be created.                                                                | Array  |         |
| `options`  | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful create operation if `options.returnResult` is `true`.
- `errors`: Return the errors encountered for each failed create operation.

### WideSkyClient.batch.update(entities, options)
**Description:** Perform an update requesting using batch functionality. The request are batched based on the number
of entities given.  
**Parameters:**

| Param      | Description                                                                            | Type   | Default |
|------------|----------------------------------------------------------------------------------------|--------|---------|
| `entities` | Entities and respective tags to be updated.                                            | Array  |         |
| `options`  | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful update operation if `options.returnResult` is `true`.
- `errors`: Return the errors encountered for each failed update operation.

### WideSkyClient.batch.deleteById(ids, options)
**Description:** Perform a deleteById operation using batch functionality. The request are batched based on the number
of entities given.  
**Parameters:**

| Param     | Description                                                                            | Type   | Default |
|-----------|----------------------------------------------------------------------------------------|--------|---------|
| `ids`     | The id of each entity to be deleted.                                                   | Array  |         |
| `options` | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful update operation if `options.returnResult` is `true`.
- `errors`: Return the errors encountered for each failed update operation.

### WideSkyClient.batch.deleteByFilter(filter, limit, options)
**Description:** Perform a deleteByFilter operation using batch functionality. The request are batched based on the
number of entities retrieved from the given filter and limit. The batched payloads are passed to 
`WideSkyClient.deleteById`.
**Parameters:**

| Param     | Description                                                                            | Type   | Default |
|-----------|----------------------------------------------------------------------------------------|--------|---------|
| `filter`  | Filter to search for entities.                                                         | String |         |
| `limit`   | Limit to be imposed on the result of the given filter.                                 | Number |         |
| `options` | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful deleteByID operation if `options.returnResult` is `true`.
- `errors`: Return the errors encountered for each failed `deleteById` operation.

### WideSkyClient.batch.hisReadByFilter(filter, from, to, options)
**Description:** Perform a hisRead using a filter to select the entities with batch functionality.  
**Parameters:**

| Param     | Description                                                                            | Type   | Default |
|-----------|----------------------------------------------------------------------------------------|--------|---------|
| `filter`  | Filter to search for entities.                                                         | String |         |
| `from`    | Haystack read range or a Date Object representing where to grab historical data from.  | Date   |         |
| `to`      | Date Object representing where to grab historical data to (not inclusive).             | Date   |         |
| `options` | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful hisRead operation if `options.returnResult` is `true`.
- `errors`: Return the errors encountered for each failed hisRead operation.

### WideSkyClient.batch.updateByFilter(filter, criteriaList, options)
**Description:** Update the entities found in the filter by the given list of criteria using batch functionality.  
**Parameters:**

| Param          | Description                                                                            | Type   | Default |
|----------------|----------------------------------------------------------------------------------------|--------|---------|
| `filter`       | Filter to search for entities.                                                         | String |         |
| `criteriaList` | A list of EntityCriteria objects defining the criteria to match against.               | Array  |         |
| `options`      | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful update operation if `options.returnResult` is `true`.
- `errors`: Return the errors encountered for each failed update operation.

### WideSkyClient.batch.hisDeleteByFilter(filter, start, end, options)
**Description:** Perform a hisDelete using a filter to select the entities.  
**Parameters:**

| Param     | Description                                                                                                                                                                                         | Type   | Default |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|---------|
| `filter`  | Filter to select the entities to be hisDelete'd.                                                                                                                                                    | String |         |
| `start`   | Starting timestamp to be deleted as a Date Object.                                                                                                                                                  | Date   |         |
| `end`     | Ending timestamp to be deleted as a Data Object (not inclusive).                                                                                                                                    | Date   |         |
| `options` | A Object defining batch configurations to be used. See README.md for more information. Option batchSize is determined by the maximum number of time series rows to be deleted across all ids given. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of each successful hisDelete operation when `options.returnResult` is `true`.
- `errors`: Return any errors encountered when performing hisDelete operations.

### WideSkyClient.batch.migrateHistory(fromEntity, toEntity, options)
**Description:** Perform a historical data migration between fromEntity and toEntity using batch functionality.  
**Parameters:**

| Param        | Description                                                                                                                                                                                                                          | Type   | Default |
|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|---------|
| `fromEntity` | The entity to migrate data from as a UUID or fqname.                                                                                                                                                                                 | String |         |
| `toEntity`   | The entity to migrate data to as a UUID or fqname.                                                                                                                                                                                   | String |         |
| `options`    | A Object defining batch configurations to be used. See README.md for more information. Option batchSize is determined by the maximum number of time series rows to be sent. The rows are defined as the time series for each entity. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the success hisWrite data that has been migrated to toEntity if `options.returnResult` is `true`.
- `errors`: Return all errors encountered.

### WideSkyClient.batch.addChildrenByFilter(filter, children, tagMap, options)
**Description:** Add the given children the parents found in the given filter.  
**Parameters:**

| Param      | Description                                                                                                                                                                                               | Type         | Default |
|------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|---------|
| `filter`   | Filter to define the parents.                                                                                                                                                                             | String       |         |
| `children` | Children to be added to the found parents.                                                                                                                                                                | Array        |         |
| `tagMap`   | A 2D Array of tags to be copied from the parent (if present) to the child entities. Each element of the Array is an Array with elements as [tagOfParent, toTagOnChild]. For example [["id", "equipRef"]]. | Array<Array> |         |
| `options`  | A Object defining batch configurations to be used. See README.md for more information.                                                                                                                    | Object       | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Return the result of the create operations performed when `options.returnResult` is `true`.
- `errors`: Return an errors encountered from the create operations performed.

### WideSkyClient.batch.multiFind(filterAndLimits, options)
**Description:** Perform multi read-by-filter requests in a single request. The number of filters sent in a request
is determined.  
**Parameters:**

| Param            | Description                                                                            | Type         | Default |
|------------------|----------------------------------------------------------------------------------------|--------------|---------|
| `filterAndLimit` | A 2D Array defining the filter and limit of each read-by-filter to be queried.         | Array<Array> |         |
| `options`        | A Object defining batch configurations to be used. See README.md for more information. | Object       | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: A 2D Array of the result from each read-by-filter given.
- `errors`: All errors encountered from performing read-by-filter operations.

### WideSkyClient.batch.updateOrCreate(entities, options)
**Description:** Perform an update or create request for the list of entities given. If the entity exists, the
entity will be checked for changes if an update is required, and send a request as necessary. If the entity does
not exist, it will be created.  
**Parameters:**

| Param      | Description                                                                            | Type   | Default |
|------------|----------------------------------------------------------------------------------------|--------|---------|
| `entities` | Array of entities to be updated or created.                                            | Array  |         |
| `options`  | A Object defining batch configurations to be used. See README.md for more information. | Object | `{}`    |

**Returns:** `Promise<{success: Array, errors: Array<{errors: String, args: Array}>}>`
- `success`: Array of entities in their current state in the WideSky database.
- `errors`: Any errors encountered during create or update operations.