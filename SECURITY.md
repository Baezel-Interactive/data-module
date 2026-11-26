# Security Policy

## Supported versions

Only the latest published version receives security fixes. Prereleases (`dev`, `alpha`, `beta`, `rc`) are provided for validation and may be replaced; production users should track `latest`.

## Reporting a vulnerability

Please report security issues privately through the repository's [security advisory form](https://github.com/Baezel-Interactive/data-module/security/advisories/new), not by opening a public issue. Include affected versions, reproduction steps and impact. You should receive an acknowledgement within a few days.

## Publishing and supply chain

Releases are published manually by a maintainer with npm two-factor authentication enabled. There is no CI service in this repository, so npm provenance is not currently generated; enabling it is deferred and requires reintroducing CI with OIDC trusted publishing.

Dependency audits are run with `npm run audit` on the publisher's machine immediately before a release. Results are point-in-time and reflect that machine's registry state. A CycloneDX SBOM is generated with `npm run sbom` and attached to the GitHub release by hand.

Credentials are never logged by the package. See the README for the destructive-operation and environment safety gates, which are enforced at module initialization.
