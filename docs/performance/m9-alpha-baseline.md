# M9 Alpha Performance Baseline

Version: 1.0 | Status: Accepted for M9 | Phase: 7 Formal Development

## 1. 目的

本文记录 M9 alpha hardening 的性能基线。目标是用可重复的 synthetic fixture 验证大型项目的基础打开路径，不让 cache rebuild 或大文本 fixture 阻塞基本编辑能力。

## 2. Fixture

M9 创建 synthetic 1,000,000-character project fixture。

Fixture 目的：

- 模拟长篇小说项目中的大章节文本。
- 验证 Repository open path 不依赖全量 UI 渲染。
- 给后续性能优化提供稳定输入。

Fixture 不是产品示例内容，不用于真实写作体验评估。

## 3. Baseline Checks

M9 覆盖：

- 生成大型 fixture。
- Repository open project path smoke。
- 确认基本 edit/save path 不被 cache rebuild 阻塞。
- 将性能检查纳入 alpha gate。

## 4. 当前结论

- Alpha 性能基线已建立。
- 当前测试重点是“路径可执行且不越界”，不是最终性能指标。
- 后续需要补充真实 UI 打开、editor mount、scroll、diff preview 的性能测量。

## 5. 后续工作

- 增加真实 renderer smoke。
- 增加 CodeMirror 6 大文本编辑测量。
- 增加 version history 大量 snapshot 场景。
- 增加 cache rebuild 与编辑并行场景。
- 形成可比较的性能阈值。
