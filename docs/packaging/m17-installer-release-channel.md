# M17 安装器与发布通道

Version: 1.0 | Status: Accepted for M17 | Phase: 7 Formal Development

## 目的

M17 将此前只有 unpacked artifact 的 beta 打包基础，推进为可本地验证的安装器与发布通道闭环。该闭环不发布产物、不 push tag、不上传文件，也不要求真实签名凭证。

## 范围

- Windows 打包继续保留 `dir` 输出，便于 artifact 检查和 secret scan；同时新增 `nsis` 安装器输出。
- 桌面应用声明自定义 icon 资源：`apps/desktop/build/icon.svg`。
- beta 发布通道使用结构化 JSON manifest：`release-channel/beta.json`。
- release notes 维护在 `docs/releases/v0.1.0-beta.md`，`npm run release:notes` 会将其复制到被忽略的 `release/notes/` 输出目录。
- `npm run release:check` 校验 package scripts、electron-builder 配置、release channel schema、release notes、icon 元数据和签名策略。

## 签名策略

M17 本地 beta artifact 明确允许未签名。release manifest 记录未来 Windows 证书签名所需的环境变量 `CSC_LINK` 与 `CSC_KEY_PASSWORD`，但 CI 和本地检查不会要求这些变量存在。notarization 不适用于当前 Windows beta 路径。

## 命令

```bash
npm run release:check
npm run release:notes
npm run package:installer
```

`package:installer` 会构建应用、运行 release 检查、生成 release notes 输出、调用 electron-builder 生成 `nsis` 和 `dir` 产物、扫描 unpacked artifact 中的疑似密钥，并写入 `release/latest-installer.txt`。

## 验收标准

- Release channel 数据通过 JSON Schema 校验。
- 安装器配置由测试和 `release:check` 覆盖。
- CI 不访问真实模型服务，也不依赖签名服务。
- 发布保持手动流程；任何 push、上传或对外发布都必须由用户另行确认。
