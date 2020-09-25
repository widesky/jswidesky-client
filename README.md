# JavaScript WideSky Client

This is a simple `Promise`-based client for the WideSky application server.

It can be used for both backend and frontend application.
See example code below on how to import it into your project.

### Usages

The following section describes how the library can be used in both `nodejs` and `browser` context.
For the subsequent commands to work, we assume that you already have a running
`Widesky` instance ready to go.

## Installing it

You can install the Widesky client library by executing the command from your console.
```
npm install @widesky/jswidesky-client --save
```

## Importing it
For browser based application, you can import the library by using the `<script>` tag.

Example:
```
<script src="node_modules/@widesky/jswidesky-client/dist/wideskyClient.min.js"></script>
```

For your debugging convenience, there is also a non minified version of the library, `wideskyClient.js`.

If this is for a NodeJS project then the following code may be used to import it.
```
const wsClient = require('@widesky/jswidesky-client');
```

## Creating an instance of the client
An instance can be instantiated by using the `WideskyClient` constructor.

Example:
```
const WideSkyClient = require('jswidesky-client').WideSkyClient;

let myClient = new WideSkyClient(
                        server.url,
                        server.username,
                        server.password,
                        server.clientId,
                        server.secret);
```

## Performing an operation
Once an instance of the `WideskyClient` has been instantiated.
The client will automatically perform authentication and maintain the widesky access token for you.
That is, you can start using it as soon as the instance is instantiated.

Querying for a list of points that are tagged with the `his` and `kind` tags, and looking up
their `fqname` virtual tag value.

```
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

See our [documentation](https://widesky.cloud/docs/reference/apis/cloud/graphql/) for more information
on the Widesky query language.

## Building the library
To build a release of the project, run;

```
npm run build
```

## Running tests

### Without coverage

```
$ npm run test
```

### With coverage

```
$ npm run coverage
```
