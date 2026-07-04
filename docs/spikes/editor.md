# Editor Spike - Novel Studio

Version: 1.0 | Status: Accepted for M5 | Phase: 7 Formal Development

## 1. 目的

本文记录 M5 编辑器选型 spike。目标不是做完整编辑器评测，而是确认 v1 章节 Markdown 编辑、保存状态、快捷键和 diff review foundation 应优先采用哪条技术路线。

## 2. 候选方案

### CodeMirror 6

优点：

- 面向文本编辑器，Markdown 支持成熟。
- 扩展模型适合后续接入 lint、selection、diff、inline decorations。
- Bundle 相对轻，适合 Electron renderer。
- 快捷键和 editor state 可控，便于和 Command Palette 协调。
- 对大文本编辑的性能路径更适合 v1 目标。

风险：

- 需要自己组合 UI、toolbar、diff 和 history 面板。
- 对复杂 IDE 功能需要逐步补 extension。

### Monaco

优点：

- IDE 功能完整。
- 内建大量编辑器能力。
- 对代码编辑体验成熟。

风险：

- Bundle 和运行时复杂度更高。
- 对小说 Markdown 写作场景偏重。
- 与 Electron renderer、主题、快捷键和轻量 diff review 的整合成本更高。

## 3. v1 决策

M5 采用 CodeMirror 6 方向。

理由：

- Novel Studio v1 的核心是长文本 Markdown 写作，不是代码 IDE。
- 需要稳定的保存状态、版本历史和 AI diff review，而不是完整代码智能。
- CodeMirror 6 更容易保持 UI 简洁、可控、可测试。
- 后续如果需要更复杂的编辑能力，可以通过 extension 逐步扩展。

## 4. 当前实现取舍

M5 已先完成 Application-backed chapter editor vertical slice：

- 打开 fixture chapter。
- 编辑内容。
- 显示 dirty/saving/saved。
- 通过 Repository 保存。
- 列出 version history。
- 预览和 restore snapshot。
- AI suggestion diff 默认 preview-only。

当前实现没有把完整 CodeMirror 集成作为阻塞项；它先验证数据流、保存状态和版本 UX。完整编辑器集成可以在后续 UI hardening 中继续补。

## 5. 后续验证项

- 真实 CodeMirror 6 集成。
- 大章节输入性能。
- 与 Command Palette 的快捷键冲突矩阵。
- Selection/range metadata，用于 AI rewrite 和 diff。
- Markdown preview 或 split view。
- 更完整的 diff component。

## 6. 验收标准

M5 完成时必须满足：

- UI 不直接访问文件系统。
- 保存路径只经过 Application/Repository。
- Dirty/saving/saved 状态可见。
- Restore 前创建 `before-rollback` snapshot。
- AI diff 默认不自动应用。
- 测试覆盖 chapter edit/save/version path。
