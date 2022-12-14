# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.6.2]

- Updated @cipherstash/stash-rs to fix security warning 

## [0.6.1]

## Fixed

- Filter out incompatible collections rather than returning an error when listing collections.
  This is a short-term fix for incompatibilities in ciphertext formats between StashJS and StashRB.

## [0.6.0]

## [0.5.0]

## Added

- Add support for ordering by range indexes on string fields

## Fixed

- Multiple code-point Unicode characters break indexing

## [0.4.6]

## Changed

- Migrate indexing to use stash-rs (again)

## Fixed

- Range queries on date or uint64 would immediately throw errors
- Date timestamps in index were encoding the day of the month wrong
- Uint64 was being turned into a buffer and reinterpreted with the wrong endianness

## [0.4.5]

## Changed

- Updated auth strategy token refresh logic

## [0.4.4]

## Changed

- Revert Migrate indexing to use stash-rs (#961)
- Revert auth strategy token refresh logic

## [0.4.3]

## Changed

- Updated record indexing to use `@cipherstash/stash-rs`
- Updated auth strategy token refresh logic

## [0.4.2]

## Added

- Console access key auth strategy

## Fixed

- When StashJS is used in a situation where an idle connection is held open for a period
  longer than the max idle connection time ECONNRESET errors would be raised. StashJS now
  will retry the request one time which causes grpc-js to re-connect.
- Bug where UnknownError would be reported because a GRPCError was being instantiated with
  a statically-unknown type due to use of `any`.

## [0.4.0]

## Fixed

- Fix bug where get, getAll, and query GRPC requests are sent twice

## Changed

- Persist record type and index field type settings
- Remove support for `number` and `bigint` field types in favour of `float64` and `uint64`
- Remove support for schema definition via the `indexedWith` TS DSL in favour of JSON schema definitions

## [0.3.12]

## Added

- Added oauth callback strategy

## [0.3.11]

## Changed

- Improved error types and wrap error messaging
- Increased directory pop count when checking if project has TypeScript

## [0.3.10]

## Changed

- Index data types to include uint64 and float64 types

## [0.3.9]

- Fix for queries on records with fields set to `0`
- Fix errors in federated auth from rate limiting
- Records without an explicit ID will still include an ID in the record

## [0.3.8]

## Changed

- Types now allow querying collections without a statically known schema

## [0.3.7]

## Fixed

- Fix for dynamic match and field dynamic match queries

## [0.3.6]

- Update README with code examples for insert and queries

## [0.3.5]

## Added

- Send StashJS version, OS, arch and whether TypeScript is being used as part of user-agent
- When importing `@cipherstash/stashjs` warn if project doesn't use TypeScript
- If no profile name is passed to `Stash.loadProfile` Stash will check for the `CS_PROFILE_NAME` env var before using the default workspace
- Public async generator function to stream records

## [0.3.4]

## Added

- Public function to parse schema definition from JSON.

## [0.3.3]

## Fixed

- Schema parsing and validation are now performed in one atomic step

## Changed

- StashJS now requires NodeJS version >= 16
- Improved error rendering on the console

## [0.3.0]

## Added

- Introduce new configuration profile storage
- Export additional type guard so that they can be used in StashCLI
- Make Stash.listCollections() also return collection metadata

## Changed

- Stash.connect() without arguments will now load configuration from the default profile
- ORE now provided by [ore.rs](https://github.com/cipherstash/ore.rs) via [Node
  ore.rs](https://github.com/cipherstash/node-ore-rs)
- Lots of error handling improvements

## Fixed

- Handle refreshing of federated AWS credentials
- Handle refreshing of device token auth credentials
- Multiple minor bug fixes

## [0.2.35]

### Fixed

- Export symbols from stashjs that were accidentally omitted

### Added

- New env var CS_AWS_FEDERATE (defaults to ON, when OFF AWS client ID & secret must be provided in env)

## [0.2.34]

### Fixed

- Ignore undefined field values during analysis instead of throwing exception

## [0.2.33]

### Added

- Authentication now possible via stored token using stash-cli

### Changed

- No longer uses AWS Cognito to exchange tokens (uses STS AssumeRoleWithWebIdentity now instead)

## [0.2.32]

### Added

- Streaming inserts

## [0.2.31]

### Changed

- Credentials now sent via gRPC header
- Removed RequestContext from gRPC protocol definitions

## [0.2.30]

### Fixed

- Authentication and token federation improvements and minor fixes

## [0.2.29]

### Changed

- Treat all document IDs as UUIDs

## [0.2.28]

- Deprecated due to erroneously publishing with npm instead of pnpm

## [0.2.27]

### Fixed

- Updated to use correct stashjs-grpc protocol files

## [0.2.26]

- Deprecated due to incorrect stashjs-grpc dependency

## [0.2.25]

### Added

- Queries can now be performed with no constraints (to retrieve all records)
- Added getAll function to retrieve several records at once by their ID

### Fixed

- Ordering by a particular field now works correctly
- Limits are now applied correctly

### Changed

- The default query limit is now set to 50
