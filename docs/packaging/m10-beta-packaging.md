# M10/M11 Beta Packaging

Version: 1.1 | Status: Accepted for M10/M11 | Phase: 7 Formal Development

## 1. 目的

本文记录 Novel Studio 的 beta packaging foundation 和 M11 package artifact stabilization。

M10 的目标是建立可重复的 renderer production build、electron-builder 配置和 package preflight gate。M11 的目标是在当前 Windows 工作站上稳定生成真实 unpacked artifact，并对 artifact 执行 secret scan。

当前仍不声明 installer、icon、signing/notarization 或 release channel 已完成。

## 2. 已完成内容

- 添加 Vite renderer bundling。
- 添加 electron-builder 配置。
- 添加 `package:check` preflight。
- 添加 `.npmrc`，配置 Electron 下载 mirror。
- 添加 `package:dir` wrapper：`scripts/package-dir.mjs`。
- 每次 `package:dir` 输出到唯一目录：`release/package-dir-<timestamp>/win-unpacked`。
- 生成 `release/latest-package-dir.txt` 指向最新 artifact。
- 添加 `scripts/artifact-secret-scan.mjs`，扫描 unpacked directory 和 `app.asar` 中的文本资源。
- 将 `release/` 加入 `.gitignore`，避免误提交打包产物。

## 3. 命令

```bash
npm run build
npm run package:check
npm run package:dir
npm run package:artifact-check
```

说明：

- `npm run build` 执行 TypeScript build 和 renderer production bundle。
- `npm run package:check` 执行 build 后检查 package scripts、build artifacts、renderer bundled JS asset、Electron mirror 和 electron-builder config。
- `npm run package:dir` 执行 build、electron-builder `--dir` 和 artifact secret scan。
- `npm run package:artifact-check` 默认读取 `release/latest-package-dir.txt`，扫描最新 artifact。

## 4. M11 根因与修复

M10 时 `npm run package:dir` 在当前 Windows/Node 20.20.2 工作站超时。M11 定位到根因：默认 GitHub Electron runtime 下载源不可达，导致 Electron runtime 获取阶段卡住。

修复：

- `.npmrc` 固定 `electron_mirror=https://npmmirror.com/mirrors/electron/`。
- `package:dir` 使用包装脚本生成唯一输出目录，避免 Windows 旧 artifact 文件锁影响复跑。
- 打包完成后自动执行 artifact secret scan。

M11 验证生成的 artifact：

```text
release/package-dir-20260704-123902/win-unpacked
```

该目录是本地构建产物，被 `.gitignore` 忽略，不提交到仓库。

## 5. 当前限制

当前可声明完成：

- packaging foundation
- package preflight gate
- renderer production bundle
- electron-builder configuration
- unpacked package artifact 稳定产出
- artifact secret scan

当前不能声明完成：

- installer artifact
- custom app icon
- signing/notarization
- release channel

这些后续项已记录到 `TECH_DEBT.md` 的 `TD-022`。

## 6. 验收状态

M10/M11 已通过：

- `npm run package:check`
- `npm run package:dir`
- `npm run package:artifact-check`
- `npm run alpha:check`
- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm run test`
- `npm run test:contract`
- `npm audit`
- `npm run test:e2e`

`npm run test:e2e` 当前只列出 0 个 Playwright 测试；后续需要补真实 smoke。
