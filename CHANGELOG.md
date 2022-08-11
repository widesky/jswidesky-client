# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).

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
[1.2.1]: https://github.com/widesky/jswidesky-client/compare/1.2.2...1.2.1
