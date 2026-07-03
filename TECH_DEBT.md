# TECH DEBT — Novel Studio

Version: 1.0 | Status: Active

## Active Items

| ID     | Source                                                   | Debt / Risk                                                                                 | Impact                                                  | Planned Resolution                                                    | Status |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| TD-005 | `ARCHITECTURE.md` 第5/7节                                | Workflow Engine 位于 Agent Engine 下层，需要明确“状态机/计划器”解释，避免实现时变成循环依赖 | 若团队误读，可能违反 P8 跨层调用规则                    | Phase 3/5 继续用接口契约和测试规则固化方向                            | Open   |
| TD-007 | `DATA_SCHEMA.md` 第20/21节                               | 迁移日志路径、项目锁策略、多窗口冲突策略尚未定稿                                            | 后续实现 Repository 时可能影响恢复和并发安全            | Phase 5/6 明确锁、migration log 和冲突处理任务                        | Open   |
| TD-008 | `DATA_SCHEMA.md` 第17节                                  | history 体积增长策略尚未量化                                                                | 长篇项目可能产生大量快照，影响 Git 管理体验             | ROADMAP 或 Task Planning 中定义归档/压缩/手动保留策略，但默认不得误删 | Open   |
| TD-009 | `DATA_SCHEMA.md` 第3/8/23节                              | 跨 JSON 文件引用完整性尚未落成具体检查规则                                                  | 引用失效会影响 UI、Context 和 AI 工作流                 | Phase 5/6 增加 Repository integrity check 任务                        | Open   |
| TD-010 | `UI_GUIDELINES.md` 第5/9节、`CODING_STANDARDS.md` 第12节 | 编辑器技术倾向为 CodeMirror 6，但尚未做 spike 验证                                          | 影响 Markdown 编辑、diff 审阅、快捷键、性能和大文件体验 | Phase 6 设置 CodeMirror 6 spike，与 Monaco 做最小对比                 | Open   |
| TD-011 | `CODING_STANDARDS.md` 第14节                             | shortcut registry 规范已定义，但快捷键冲突表尚未生成                                        | Electron、系统快捷键、编辑器快捷键可能冲突              | Phase 6 设置 shortcut registry 与冲突矩阵任务                         | Open   |
| TD-012 | `CODING_STANDARDS.md` 第13节                             | 组件策略倾向 headless primitives + local tokens，但具体库尚未验证                           | 影响可访问性、主题 tokens、表单和弹层一致性             | Phase 6 设置组件 primitive spike                                      | Open   |
| TD-014 | `CODING_STANDARDS.md` 第6节                              | 已有 ESLint 相对跨层 import 初步限制，但 dedicated dependency boundary 工具尚未选型         | 分层规则仍可能需要更强的自动化检查                      | Phase 7 M2/M3 评估 ESLint boundaries 或 dependency graph 工具         | Open   |
| TD-015 | `TESTING.md` 第5/7/8节                                   | fixture 套件、CI 配置、coverage threshold 尚未实现                                          | 测试规范无法自动执行                                    | Phase 6 拆分 fixtures、CI、coverage、Playwright smoke 任务            | Open   |
| TD-017 | `ROADMAP.md` M1/M2                                       | 包管理器、schema codegen 工具、dependency boundary 工具仍需最终选择                         | 影响工具链任务执行细节                                  | Phase 7 M1/M2 以最小 spike 做选择并记录                               | Open   |
| TD-018 | `ROADMAP.md` M6                                          | Provider 实现顺序已定义，但除首批外的测试 fixture 尚未准备                                  | 多 Provider 扩展可能延迟                                | M6 只实现首批，后续 Provider 进入 roadmap 后续批次                    | Open   |

## Resolved Items

| ID     | Resolved In | Resolution                                                                                                                                                      |
| ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-002 | 2026-07-03  | 当前目录已确认为有效 Git 仓库，并已连接 `origin` 到 `https://github.com/47ronintop/Novel-Studio.git`。                                                          |
| TD-001 | 2026-07-03  | 已删除 `PROJECT_CONSTITUTION.md` 第4/6/7节中的独立 `text` 粘贴残留。                                                                                            |
| TD-003 | 2026-07-03  | `ROADMAP.md` 已定义 Provider 实现顺序：OpenAI Compatible API、OpenAI、Anthropic、Google Gemini、Ollama、OpenRouter、DeepSeek、LM Studio、vLLM、智谱、通义千问。 |
| TD-004 | 2026-07-03  | `adr/ADR-0001-engine-runtime-language.md` 已明确核心 Engine 使用 TypeScript Strict，Python 仅限插件/外部工具边界。                                              |
| TD-016 | 2026-07-03  | 已创建初始文档提交；远端推送仍等待用户确认默认分支策略。                                                                                                        |
| TD-006 | 2026-07-03  | 用户已发布初始提交到远端；本地 `main` 已跟踪 `origin/main`。外部 `git ls-remote` 复验受当前网络连接限制，后续联网恢复后可再次确认。                             |
| TD-013 | 2026-07-03  | M1 已创建 npm workspaces、TypeScript strict、ESLint、Prettier、Vitest、Playwright 和 fixture 基础配置；schema codegen 选择保留在 TD-017/M2。                    |
