# M10 Beta Packaging Foundation

Version: 1.0 | Status: Accepted for M10 | Phase: 7 Formal Development

## 1. 目的

本文记录 M10 beta packaging foundation。目标是先建立可重复的 renderer production build、electron-builder 配置和 package preflight gate，为后续真实 beta artifact 稳定化做准备。

M10 不声明完整 installer/signing 已完成。

## 2. 已完成内容

- 添加 Vite renderer bundling。
- 添加 electron-builder 配置。
- 添加 `package:check` preflight。
- 添加 `package:dir` 脚本。
- 更新 alpha gate，使其检查 packaging foundation。
- 记录当前 packaging host 限制。

## 3. 命令

```bash
npm run build
npm run package:check
npm run package:dir
```

说明：

- `npm run build` 执行 TypeScript build 和 renderer production bundle。
- `npm run package:check` 执行 build 后检查 package scripts、build artifacts、renderer bundled JS asset 和 electron-builder config。
- `npm run package:dir` 执行 build 后调用 `electron-builder --dir`，用于生成 unpacked package directory。

## 4. 当前限制

在当前 Windows/Node 20.20.2 工作站上，`npm run package:dir` 超过 180 秒命令超时。

因此当前可声明完成的是：

- packaging foundation
- package preflight gate
- renderer production bundle
- electron-builder configuration

当前不能声明完成的是：

- unpacked package artifact 稳定产出
- installer artifact
- signing/notarization

该限制已记录到 `TECH_DEBT.md` 的 `TD-021`。

## 5. 后续 M11 建议

- 在稳定 packaging host 上运行 `npm run package:dir`。
- 如果仍超时，定位 electron-builder 卡住阶段。
- 稳定 unpacked package 后再添加 installer targets。
- artifact 生成后执行 secret scan。
- 再决定是否引入 signing。

## 6. 验收状态

M10 已通过：

- `npm run package:check`
- `npm run alpha:check`
- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm run test`
- `npm run test:contract`
- `npm audit`
- `npm run test:e2e`

`npm run test:e2e` 当前只列出 0 个 Playwright 测试；后续需要补真实 smoke。
