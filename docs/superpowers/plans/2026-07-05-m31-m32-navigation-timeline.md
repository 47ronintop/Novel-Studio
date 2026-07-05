# M31/M32 搜索跳转与时间线实施计划

> **给 agentic worker：** 执行本计划时应使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项推进。步骤使用 checkbox（`- [ ]`）跟踪状态。

**目标：** 搜索结果可点击跳转，时间线入口成为真实主视图。

**架构：** UI 只回传结构化 result/entry id，renderer 使用现有 project/story bible bridges 执行跳转。M31/M32 不新增 Repository、IPC、真实模型调用或文件系统直连。

**技术栈：** TypeScript strict、React、Vitest、Electron renderer。

---

### Task 1: 文档

**Files:**

- Create: `docs/productization/m31-search-result-navigation.md`
- Create: `docs/productization/m32-timeline-main-view.md`
- Create: `docs/superpowers/specs/2026-07-05-m31-m32-navigation-timeline-design.md`
- Create: `docs/superpowers/plans/2026-07-05-m31-m32-navigation-timeline.md`

- [x] **Step 1: 定义 M31/M32 范围**

记录搜索跳转、时间线主视图和非范围。

### Task 2: M31 UI TDD

- [x] **Step 1: 写搜索结果点击红灯测试**
- [x] **Step 2: 实现 `onSearchResultOpen`**
- [x] **Step 3: 目标测试绿灯**

### Task 3: M31 Renderer 接线

- [x] **Step 1: 实现搜索结果跳转 handler**
- [x] **Step 2: M31 目标验证**
- [x] **Step 3: M31 本地提交**

### Task 4: M32 UI TDD

- [x] **Step 1: 写时间线主视图红灯测试**
- [x] **Step 2: 实现 Timeline Activity 主视图**
- [x] **Step 3: 目标测试绿灯**

### Task 5: M32 Renderer 接线与文档

- [x] **Step 1: 实现时间线条目跳转 handler**
- [x] **Step 2: 更新 ROADMAP / INDEX / CHANGELOG / release docs**
- [x] **Step 3: 全量验证与安装包检查**
- [x] **Step 4: M32 本地提交，不 push**
