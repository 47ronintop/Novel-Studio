# M20 搜索与索引体验

Version: 1.0 | Status: Accepted for M20 | Phase: Post-M18 Productization

## 目标

M20 将 M19 的“搜索入口可点击”推进为项目内全文搜索最小闭环。用户打开项目后，可以重建搜索索引，并在 Search 视图中搜索章节正文、章节标题、人物、世界观、大纲、时间线和记忆。

## 范围

M20 包含：

- 可重建的本地搜索索引，落在 `cache/indexes/search.json`。
- 搜索索引 JSON Schema 与 contract fixtures。
- Repository 层从章节和 Story Bible 资产构建索引，不读取 `history/`，不把 cache 当作唯一真实来源。
- Application 层提供 Search Session，负责重建索引和查询。
- Desktop IPC / preload 暴露搜索命令，renderer 不直接访问文件系统。
- Search Activity UI 显示查询框、重建按钮、索引状态、结果列表和空结果反馈。

M20 不包含：

- SQLite、向量检索、语义排序或后台常驻索引服务。
- 搜索结果直接写入 Context Engine。
- Story Bible 完整编辑表单；该范围已由 M21 覆盖。
- 设置页完整产品化；该范围已由 M22 覆盖。

## 数据边界

索引文件属于纯派生 cache，可随时删除并从项目源文件重建。索引条目保留稳定 source reference：

- `chapter`：章节 id、标题、正文摘要和相对路径。
- `story.character` / `story.world` / `story.outline` / `story.timeline`：Story Bible asset id、标题、摘要和相对路径。
- `memory`：memory id、标题、内容和相对路径。

搜索索引不得包含 API key、secret 引用的明文解析值或日志输出。M20 不读取 settings secret，也不调用真实模型。

## UI 行为

Search 视图使用紧凑产品界面：

- 顶部输入框输入关键词。
- “搜索”按钮执行查询。
- “重建索引”按钮显式刷新 cache。
- 搜索结果显示类型、标题、来源、命中摘要和分数。
- 未打开项目或无结果时显示中文空状态，而不是静默失败。

## 验收标准

- `search-index` schema 有 valid / invalid fixtures，并通过 contract test。
- Repository 测试证明索引覆盖章节与 Story Bible，并写入 `cache/indexes/search.json`。
- Application 测试证明未打开项目时返回稳定错误，打开项目后可搜索。
- Desktop IPC/preload 测试证明搜索命令只通过 allowlisted channel 暴露。
- UI 测试证明 Search Activity 渲染真实搜索面板和结果。
