# M10 Beta Packaging Notes

Date: 2026-07-04

## Scope

M10 adds the first beta packaging foundation:

- Renderer bundling through Vite.
- Electron packaging configuration through electron-builder.
- A fast package preflight gate that verifies build artifacts and packaging configuration.
- A manual `package:dir` command for producing an unpacked app artifact in an environment where
  electron-builder can complete.

## Commands

```bash
npm run build
npm run package:check
npm run package:dir
```

`npm run build` runs TypeScript project references and then bundles the renderer to
`apps/desktop/dist/renderer`.

`npm run package:check` runs the build and validates the Electron main/preload artifacts, the Vite
renderer bundle, workspace package `dist` outputs, and electron-builder configuration.

`npm run package:dir` runs electron-builder with:

```bash
electron-builder --dir --config apps/desktop/electron-builder.config.cjs
```

## Current Limitation

On the current Windows/Node 20.20.2 workstation, `npm run package:dir` exceeded the 180 second local
command timeout during electron-builder execution. The command remains available, but it is not part
of the automated test gate yet.

The repository therefore treats `package:check` as the repeatable beta packaging gate until the
packaging environment is stabilized.

## Follow-Up

- Verify `package:dir` on a packaging host with suitable Node/electron-builder runtime support.
- Decide whether to pin a supported electron-builder version or raise the packaging Node runtime.
- Add signed installer targets only after unpacked packaging is stable.
