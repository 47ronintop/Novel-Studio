# M17 Installer and Release Channel

Version: 1.0 | Status: Accepted for M17 | Phase: 7 Formal Development

## Purpose

M17 turns the existing unpacked beta packaging foundation into a local installer and release-channel workflow. It does not publish artifacts, push tags, upload files, or require real signing credentials.

## Scope

- Windows packaging keeps `dir` output for artifact inspection and adds `nsis` for installer output.
- The desktop app declares a custom icon asset at `apps/desktop/build/icon.svg`.
- The beta release channel is a structured JSON manifest at `release-channel/beta.json`.
- Release notes are maintained in `docs/releases/v0.1.0-beta.md` and can be copied into ignored `release/notes/` output by `npm run release:notes`.
- `npm run release:check` validates package scripts, builder config, release channel schema, release notes, icon metadata, and signing policy.

## Signing Policy

M17 local beta artifacts are explicitly allowed to be unsigned. The release manifest records future Windows signing environment variables, `CSC_LINK` and `CSC_KEY_PASSWORD`, but CI and local checks do not require them. Notarization is not applicable to the Windows beta path.

## Commands

```bash
npm run release:check
npm run release:notes
npm run package:installer
```

`package:installer` builds the app, runs release checks, generates release notes output, invokes electron-builder for `nsis` and `dir`, scans the unpacked artifact for secret-like values, and writes `release/latest-installer.txt`.

## Acceptance

- Release channel data validates through JSON Schema.
- Installer configuration is checked by tests and `release:check`.
- CI remains offline with respect to model providers and signing services.
- Publishing remains manual and requires a separate user-approved action.
