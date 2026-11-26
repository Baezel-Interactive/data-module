# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/) and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

## [1.0.0-dev.1] - 2026-11-26

### Fixed

- `baezel-data` now runs when invoked through the npm bin shim; the entry-point check resolves symlinks before comparing paths.

## [1.0.0-dev.0] - 2026-11-26

### Changed

- Foundation for the 1.0.0 line: ESM-only package with `types` + `default` export conditions, Node 22.18+ floor, no top-level await, strict TypeScript, and a node-version guard imported from every entry point.
- Test suite migrated from Jest to vitest with `unplugin-swc` so decorator metadata is preserved; added type-level tests.
- Added local verification scripts: `verify:gate`, `verify:fast`, `verify`, CJS packed-tarball smoke, guard-path check, no-TLA check, attw/publint validation, audit and SBOM generation.
- Added BYOC registration by config with zod validation for both `register` and `registerAsync`, plus a discriminated `connector`/`driver` union.
- Added a typed error taxonomy with driver-error mapping, credential redaction for errors/logs/hooks, and an experimental `Hooks` interface.
- Added boot-time database provisioning for Postgres and MySQL with concurrency-safe creation, bounded retries, configurable maintenance database, hook events and redacted logging; Mongo receives a connectivity check with a lazy-creation message.
- Added entity autoload from compiled JavaScript glob patterns and opt-in TypeORM decorator discovery, with startup counts, source reporting and SQL fail-fast on zero entities.
- Expanded the repository contract with CRUD, count, declared ID types and required upsert conflict targets. Added TypeORM/Prisma transaction and health support, a native Mongo connector with `ObjectId` conversion and session transactions, and switched lifecycle shutdown to `OnApplicationShutdown`.
- Added production safety gates, environment override warnings, an explicit TLS opt-out, hidden raw `DataSource`, a best-effort destructive-SQL guard, normalized migration checksums, and migration lock primitives for Postgres/MySQL/Mongo.
- Added per-driver pool mapping, bounded shutdown, cockatiel-backed idempotent retries and a per-connector circuit breaker, a migrations/seed/status runner with the `baezel-data` CLI, an experimental `/otel` subpath, and env-gated Testcontainers integration tests.
- Documentation updated for manual publishing and explicit npm dist-tags.

## [0.0.2]

### Added

- Initial public release with a driver-agnostic connector contract, optional Prisma and TypeORM subpaths, and CommonJS output.
