# M10-M13 Beta Packaging and CI

Version: 1.2 | Status: Accepted for M10-M13 | Phase: 7 Formal Development

## 1. 目的

本文记录 Novel Studio 的 beta packaging foundation、M11 package artifact stabilization，以及 M13 真实 E2E 与 CI gate。

M10 建立 renderer production build、electron-builder 配置和 package preflight gate。M11 稳定生成 Windows unpacked artifact 并执行 artifact secret scan。M13 增加真实 Electron Playwright smoke，并把本地质量门禁接入 GitHub Actions。

当前仍不声明 installer、icon、signing/notarization 或 release channel 已完成。

## 2. 已完成内容

- Vite renderer bundling。
- electron-builder 配置。
- `package:check` preflight。
- `.npmrc` Electron 下载 mirror。
- `package:dir` wrapper：`scripts/package-dir.mjs`。
- `release/package-dir-<timestamp>/win-unpacked` 单一输出目录。
- `release/latest-package-dir.txt` 指向最新 artifact。
- `scripts/artifact-secret-scan.mjs` 扫描 unpacked directory 和 `app.asar` 中的文本资源。
- `release/` 加入 `.gitignore`，避免误提交打包产物。
- 真实 Electron Playwright smoke：创建项目、创建章节、编辑、保存并验证文件落盘。
- `.github/workflows/ci.yml` 运行 format、lint、typecheck、tests、contract、e2e、package、alpha、audit 和 artifact secret scan。

## 3. 命令

```bash
npm run build
npm run test:e2e
npm run package:check
npm run package:dir
npm run package:artifact-check
```

说明：

- `npm run build` 执行 TypeScript build 和 renderer production bundle。
- `npm run test:e2e` 执行 build 后运行真实 Playwright Electron smoke。
- `npm run package:check` 执行 build 后检查 package scripts、build artifacts、renderer bundled JS asset、Electron mirror 和 electron-builder config。
- `npm run package:dir` 执行 build、electron-builder `--dir` 和 artifact secret scan。
- `npm run package:artifact-check` 默认读取 `release/latest-package-dir.txt`，扫描最新 artifact。

## 4. M11 根因与修复

M10 时 `npm run package:dir` 在当前 Windows/Node 20.20.2 工作站超时。M11 定位根因：默认 GitHub Electron runtime 下载源不可达，导致 Electron runtime 获取阶段卡住。

修复：

- `.npmrc` 固定 `electron_mirror=https://npmmirror.com/mirrors/electron/`。
- `package:dir` 使用包装脚本生成唯一输出目录，避免 Windows artifact 文件锁影响复跑。
- 打包完成后自动执行 artifact secret scan。

## 5. M13 运行时修复

真实 Electron e2e 暴露了两个此前单元测试无法覆盖的问题：

- workspace package 的 runtime `exports.default` 指向源码 `src/index.ts`，Electron 主进程运行时会尝试加载源码并失败。M13 改为指向已编译 `dist` artifact。
- sandbox preload 不能可靠加载 ESM preload。M13 新增 `apps/desktop/src/preload/index.cts`，编译为 `dist/preload/index.cjs`，主进程使用该 CommonJS preload 暴露 `window.novelStudio`。

## 6. 当前限制

当前可以声明完成：

- packaging foundation
- package preflight gate
- renderer production bundle
- electron-builder configuration
- unpacked package artifact 稳定产出
- artifact secret scan
- real Electron Playwright smoke
- GitHub Actions CI gate

当前不能声明完成：

- coverage threshold
- installer artifact
- custom app icon
- signing/notarization
- release channel

这些后续项已记录到 `TECH_DEBT.md`。
