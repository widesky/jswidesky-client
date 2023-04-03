# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]
### ADDED
- Added support for the WideSky `createUser` endpoint, `/api/admin/user`. As its name implies, this function is use for 
  creating a new user account in WideSky through one of the supported local/scram authentication method.
- Added support for the WideSky `watchSub` endpoint, `/api/watchSub`. This allows a user to subscribe to a watch.
- Added a function to extend the lease of a watch.
- Added support for the WideSky `watchUnsub` endpoint, `/api/watchUnsub`. This allows a user to unsubscribe to a watch.
- Added a function to retrieve an API socket using a watch.

## [2.0.2] - 2022-11-07
### FIXED
- Added conditional import for importing `axios` when run by either a browser or node process.

## [2.0.1] - 2022-11-07
### CHANGED
- Updated build packages 

## [2.0.0] - 2022-11-03
### FIXED
- Replaced `x instanceof Array` with `Array.isArray(x)` to resolve.
  peculiar issues with passing arrays in NodeRED function nodes.
- Formatting using `moment` includes the milliseconds of the DateTime object.
- Invalid inputs for `WideSkyClient.find` and `WideSkyClient.deleteByFilter` are caught before 
  making a request to the given `uri` for the client.
- An empty of array of entity id's given to functions `WideSkyClient.deleteById` and 
  `WideSkyClient.read` will now throw an error.

### CHANGED
- Replaced deprecated packages `request` and `request-promise` for `axios`.
- Updated packages:
  - `moment-timezone` v0.5.31 -> v0.5.38.
  - `jsesc` v2.5.1 -> v3.0.2.
- Converted WideSkyClient to an ES6 class.

### REMOVED
- Package `bluebird`

## [1.2.2] - 2022-08-11
### CHANGED
- Updated the versions of dependencies used to fix security issues found in
  underlying libraries.

## [1.2.1] - 2022-07-19
### FIXED
- FileUpload API - supplying null to the `tag` argument no longer cause error.

## [1.2.0] - 2022-07-18
### ADDED
- Updated docs to include examples on how to include the library using es6 `import` statement.
- Added file storage APIs for storing a file and retrieval of it.

### CHANGED
- Updated the build system to use webpack instead of grunt-browserify.

## [1.1.2] - 2020-11-23
### FIXED
- Fixed a bug whereby the client will does not decompress the response payload for its user.

## [1.1.1] - 2020-11-23
### CHANGED
- The http header `Accept-Content` is now included as part of the http requests
  made by the client. Benefit of it is that the payload of a http response (generally
  received from the Widesky api server will be significantly smaller.

  This default behaviour may be switched off via the api `setAcceptGzip(false)`.

## [1.1.0] - 2020-11-23
### ADDED
- The main documentation has been refactored to explain how the client can be used.
- Added the minified version of the client library for web applications.
- Added graphql utilities.
- Added CHANGELOG.md to track release changes.

## [1.0.0] - 2020-09-09
### ADDED
- Initial production ready release

## [0.1.1] - 2020-09-08
### ADDED
- Alpha release

[Unreleased]: https://github.com/widesky/jswidesky-client/compare/master...1.2.2
[1.0.0]: https://github.com/widesky/jswidesky-client/compare/1.0.0...1.0.0
[1.1.0]: https://github.com/widesky/jswidesky-client/compare/1.1.0...1.0.0
[1.1.1]: https://github.com/widesky/jswidesky-client/compare/1.1.1...1.1.0
[1.1.2]: https://github.com/widesky/jswidesky-client/compare/1.1.2...1.1.1
[1.2.0]: https://github.com/widesky/jswidesky-client/compare/1.2.0...1.1.2
[1.2.1]: https://github.com/widesky/jswidesky-client/compare/1.2.1...1.2.0
[1.2.2]: https://github.com/widesky/jswidesky-client/compare/1.2.2...1.2.1
[2.0.0]: https://github.com/widesky/jswidesky-client/compare/2.0.0...1.2.2
[2.0.1]: https://github.com/widesky/jswidesky-client/compare/2.0.1...2.0.0
