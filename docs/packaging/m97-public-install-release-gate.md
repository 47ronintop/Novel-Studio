# M97 Public Install Release Gate

Version: 1.0 | Status: Accepted for M97 | Last Updated: 2026-07-06

## Goal

M97 verifies the public Windows install gate before v1 ship. This gate does not publish, upload, or push artifacts; it proves the repository has the checks required before a public installer is handed to users.

## Windows public install gate

- `signing.required=true` for public Windows distribution.
- Local beta artifacts may remain unsigned, but public release readiness must document how signing failure blocks release.
- `npm run test:e2e` must remain part of the public install gate because it verifies install-like startup, create/open project, AI suggestion review, save, close, reopen, and continued editing.
- `npm run package:artifact-check` must remain part of the gate so packaged artifacts are scanned for secrets before release.
- `npm run release:check` must verify the release channel manifest, release notes, installer config, public signing policy document, and gate scripts without network publishing.
- No macOS notarization is required unless macOS artifacts enter v1.

## Release Decision

The public install gate passes only when the release checklist can be reproduced locally and no step requires private credentials during CI. Real certificate material stays outside the repository and is referenced only through the signing procedure.
