# STORY_BIBLE - Novel Studio

Version: 1.0 | Status: Accepted for M16 | Phase: 7 Formal Development

## 1. 目的

Story Bible Modules 将项目设定资产变成可编辑、可校验、local-first 的数据，供作者和 AI workflow 使用。M16 覆盖人物、世界观、大纲、时间线事件和记忆。

Story Bible 不是聊天记录、隐藏模型状态或派生缓存。它是用户拥有的项目数据，以 JSON 存放在项目目录中，并且在跨越 Repository、Application 和 Context 边界前必须完成校验。

## 2. 范围

M16 实现最小闭环：

- 读取、列出并保存 `characters/` 下的人物资产。
- 读取、列出并保存 `world/` 下的世界观资产。
- 读取并保存主大纲 `outline/outline.json`。
- 读取并保存时间线事件 `timeline/events.json`。
- 读取、列出并保存 `memories/` 下的记忆。
- 将选中的 Story Bible 资产转换为显式 Context Engine candidates。
- 暴露最小 Application 与 Desktop IPC 接口供 Story Bible 访问。
- 在工作区中展示 Story Bible 摘要，UI 不直接访问文件系统。

M16 不包含人物关系图可视化、语义向量检索、从完整章节批量 AI 抽取、插件访问，也不允许模型输出自动修改 Story Bible 资产。

## 3. 数据模型

持久化文件使用现有 schema 契约：

- `story-asset.schema.json` 用于人物、世界观、大纲和时间线资产 payload。
- `memory.schema.json` 用于长期记忆、风格记忆和摘要记忆。

Story Bible 资产使用稳定 ID。章节和 workflow 结果可以引用这些 ID，但自然语言正文不能成为跨 Agent 契约。未知用户字段在校验后继续保留，与现有 schema 策略一致。

记忆不是缓存数据，不能被 cache cleanup 删除。AI 生成的记忆必须经过用户确认，或者默认标记为不具备高置信 Context 资格。

## 4. Repository 边界

`StoryBibleRepository` 是 M16 中唯一读写 Story Bible 项目文件的组件。

规则：

- 所有读取都必须先通过 schema package 校验 JSON，再返回数据。
- 所有写入都必须先校验，再原子持久化。
- 可选集合缺失时，在安全场景返回空列表；格式错误文件返回稳定 Unified Errors。
- 大纲和时间线是单例文件。
- 人物、世界观资产和记忆是集合文件，只能从允许目录中发现。
- Repository 代码不构建 prompt、不调用模型、不决定 workflow 状态。

## 5. Application 边界

`StoryBibleSession` 暴露面向用户的用例：

- 加载 Story Bible snapshot。
- 保存一个 story asset 或 memory。
- 从当前 snapshot 构建 Context Engine candidates。

Session 依赖 Story Bible repository port，并返回结构化结果。它不直接访问 Node 文件系统 API。

## 6. Context Candidate 策略

Context Engine 仍然是纯选择器，不扫描项目目录。

M16 新增 Application 侧 adapter，将 Story Bible 资产映射为显式 candidates：

- `character` candidates 来自 active 人物摘要。
- `world` candidates 来自 active 世界观资产摘要。
- `timeline` candidates 来自时间线事件摘要。
- `memory` candidates 来自 active 记忆，并携带 memory confidence。
- `goal` 和 chapter candidates 仍由具体 workflow caller 提供。

Candidates 必须包含 source references。未确认记忆会以低置信 metadata 传入，使现有 Context Engine filtering 可以在没有策略放行时排除它们。

## 7. UI 与 IPC

Desktop 通过白名单 Application IPC channels 暴露 Story Bible。Renderer 代码只调用 preload APIs，绝不读取项目文件。

M16 UI 刻意保持最小范围：

- Navigator counts 反映 Story Bible 资产数量。
- Inspector 或小面板可以展示资产标题、类型、状态和 context eligibility。
- 保存操作必须结构化，并由 schema 支撑。
- 后续里程碑如加入 AI 生成变更，必须在用户确认前保持建议态。

## 8. 测试

M16 测试覆盖必须包括：

- 每类 Story Bible 资产的 Repository list/read/save。
- 无效 Story Bible 与 memory payload 的 schema 拒绝。
- Application snapshot 与 Context candidate 创建。
- Desktop IPC 白名单和 handler wiring。
- UI 渲染 Story Bible 摘要时不得暴露明文密钥，也不得访问文件系统。

CI 不得调用真实模型。测试应使用临时项目目录或 in-memory ports，并与现有 Repository 和 Application 测试保持一致。

## 9. 验收标准

M16 完成条件：

- Story Bible 设计已文档化。
- Story Bible 资产可以通过 Repository 和 Application 边界持久化与加载。
- 可以从 Story Bible 数据生成 Context Engine candidate input，且不会盲目塞入全项目内容。
- Desktop 通过 IPC 和 preload APIs 暴露最小 Story Bible surface。
- `npm run format`, `npm run typecheck`, `npm run lint`, targeted tests, and the standard test suite pass locally.
- Roadmap、Index 和 Changelog 在提交前反映 M16 完成状态。
