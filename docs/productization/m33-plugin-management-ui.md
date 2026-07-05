# M33 插件管理 UI

版本：1.0 | 状态：M33 已采纳 | 阶段：Post-M18 产品化打磨

## 目标

M33 将 M18 的插件注册表能力暴露到设置页，让用户能看到当前项目声明了哪些插件、启用状态、manifest 路径和已授权权限范围。

## 范围

M33 包含：

- Application 层提供插件注册表摘要读取接口。
- Desktop IPC/preload 暴露只读插件注册表读取通道。
- Settings 视图增加“插件管理”区域。
- 插件列表显示 plugin id、启用状态、manifest 路径、权限授权摘要。
- UI 提供刷新按钮，通过 preload/API 重新读取注册表。

M33 不包含：

- 插件市场、远程下载、安装或更新。
- 执行第三方插件代码。
- 读取插件 manifest 后注册命令或 workflow step。
- 修改 `plugins/plugins.json` 的启用状态或授权策略。

## 验收标准

- UI 不直接访问文件系统。
- 插件注册表读取走 Application/Repository/IPC 边界。
- 读取失败时显示中文错误反馈，错误不得包含密钥、token 或用户正文。
- 默认空注册表显示中文空状态。
