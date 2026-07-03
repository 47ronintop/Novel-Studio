# TESTING — Novel Studio

Version: 1.0 | Status: Draft for Review | Phase: 5 Development Standards

## 1. 文档目的

本文定义 Novel Studio v1 的测试策略、测试分层、Mock/Fixture 规则、LLM 测试边界、UI 测试、Repository 测试、Schema 测试、CI 门槛和验收标准。本文与 `CODING_STANDARDS.md` 同属 Phase 5。

本文不编写测试代码，不建立 CI 配置，不进入 Phase 6。

## 2. Testing Principles

- 可复现优先：CI 不依赖真实模型输出。
- Contract-first：跨层数据先测 Schema。
- Boundary-first：Repository、LLM Adapter、Workflow、Agent handoff 是高风险边界，优先覆盖。
- Local-first：文件系统读写、历史、恢复、cache 重建必须有测试。
- 用户保护：自动保存、崩溃恢复、版本回滚和 AI 应用前快照必须有测试。

## 3. Test Pyramid

```text
E2E / Playwright smoke tests
Integration tests
Contract tests
Unit tests
Static checks
```

目标：

- Unit tests 数量最多。
- Contract tests 覆盖所有 Schema 和 Adapter contract。
- Integration tests 覆盖跨模块数据流。
- E2E 只覆盖关键路径，不追求穷举。

## 4. Required Test Types

### 4.1 Static Checks

必须包括：

- TypeScript typecheck。
- ESLint。
- Prettier check。
- dependency boundary check。
- Markdown docs placeholder scan。

### 4.2 Schema Contract Tests

覆盖：

- valid fixture passes。
- invalid fixture fails with stable error。
- unknown field preservation policy。
- schema version mismatch。
- migration fixture。

涉及对象：

- project metadata。
- settings。
- chapter frontmatter。
- story assets。
- memories。
- prompt template。
- agent config。
- workflow definition。
- context bundle。
- agent handoff。
- LLM request/response。
- unified error。
- version record。
- recovery record。

### 4.3 Repository Tests

覆盖：

- atomic write success。
- write failure does not corrupt previous file。
- history snapshot creation。
- before-ai-apply snapshot。
- before-rollback snapshot。
- recovery record update。
- cache invalidation。
- cache clear only touches `cache/`。
- `history/` and `memories/` protected from cleanup。
- corrupted frontmatter diagnostic without body deletion。

### 4.4 Workflow Engine Tests

覆盖：

- step ordering。
- state transitions。
- retry policy。
- failure policy。
- user confirmation gate。
- no upward call into Agent Engine。
- handoff payload schema validation。

### 4.5 Context Engine Tests

覆盖：

- context budget enforcement。
- exclusion trace。
- memory confidence filtering。
- no full-novel blind stuffing。
- source reference trace。
- token estimate fallback。

### 4.6 Agent Engine Tests

覆盖：

- agent input schema validation。
- agent output schema validation。
- invalid JSON repair policy boundary。
- structured handoff creation。
- no direct project write。

### 4.7 LLM Adapter Tests

使用 mock provider 和 fixtures 覆盖：

- streaming response。
- non-streaming response。
- timeout。
- retry with exponential backoff。
- rate limit。
- provider error normalization。
- usage and cost estimate。
- redaction of secrets。

禁止：

- CI 中调用真实模型。
- 用真实模型输出作为断言。
- 在 fixture 中保存明文 API Key。

### 4.8 UI Tests

使用 component tests + Playwright smoke tests。

覆盖：

- Command Palette opens and executes safe command。
- project opens and shows navigator。
- chapter editor dirty/saving/saved state。
- AI result remains suggestion-state before user confirmation。
- version history visible。
- settings does not reveal API Key。
- keyboard focus order。
- reduced motion mode。

### 4.9 Plugin Boundary Tests

覆盖：

- plugin permission declaration required。
- denied access when capability missing。
- plugin cannot bypass Repository。
- Python plugin IPC uses JSON schema。

## 5. Fixture Strategy

Fixture 目录建议：

```text
fixtures/
├── projects/
│   ├── minimal-valid/
│   ├── corrupted-frontmatter/
│   ├── missing-reference/
│   └── recovery-needed/
├── schemas/
│   ├── valid/
│   └── invalid/
├── llm/
│   ├── streaming-success.json
│   ├── non-streaming-success.json
│   ├── rate-limit-error.json
│   └── malformed-json-output.json
└── workflows/
    ├── review-chapter-success.json
    └── validation-failure.json
```

规则：

- fixture 必须脱敏。
- fixture 必须小而明确。
- 大型 fixture 只用于性能/集成测试。
- 修改 fixture 必须说明原因。

## 6. Mock Rules

必须可 mock：

- clock。
- id generator。
- file system adapter。
- LLM provider。
- plugin runtime。
- logger。
- secret store。

规则：

- Mock 不得绕过被测模块的公开契约。
- Repository 测试优先使用临时目录，而不是纯内存 mock。
- LLM 测试使用 mock provider，不使用真实网络。

## 7. CI Quality Gates

每个 PR 或主分支提交必须通过：

```text
format check
lint
typecheck
unit tests
contract tests
integration tests for changed packages
docs placeholder scan
```

发布候选必须额外通过：

```text
Playwright smoke tests
package/build check
fixture migration tests
security redaction tests
```

## 8. Coverage Expectations

覆盖率不是唯一目标，但 v1 建议：

- shared/schema utilities：90%+
- repository：85%+
- workflow/context/agent engines：85%+
- llm-adapter：85%+
- UI components：关键状态覆盖，不追求数字虚高。

不接受：

- 只靠 snapshot test。
- 覆盖率高但关键边界无测试。
- 真实模型输出驱动 CI。

## 9. Regression Test Policy

每个已修复缺陷必须新增回归测试，除非无法自动化，并记录原因。

高优先级回归类别：

- 数据丢失。
- history/memories 误删。
- API Key 泄露。
- AI 未确认内容写入正式资产。
- 跨层调用。
- Schema migration 破坏用户数据。

## 10. Test Data Safety

禁止：

- 在 fixture 中提交真实 API Key。
- 提交用户真实小说正文。
- 提交可识别个人信息。
- 将生产日志作为测试 fixture。

允许：

- 人工编写的短文本 fixture。
- 合成项目 fixture。
- 脱敏 provider error fixture。

## 11. Performance Tests

v1 性能基准：

- 打开 100 万字项目时，基础阅读和编辑不被 cache 重建阻塞。
- 单章 Markdown 编辑保持响应。
- Search/index rebuild 可取消或后台运行。
- Context build 受 token budget 限制。

性能测试不要求 Phase 5 实现，但 Phase 6 必须安排任务。

## 12. Accessibility Tests

覆盖：

- keyboard navigation。
- focus visible。
- aria labels for icon buttons。
- dialog/menu focus trap。
- contrast checks。
- reduced motion。

Playwright 可覆盖核心交互；视觉细节需结合人工审查。

## 13. Security Tests

覆盖：

- secret redaction。
- API Key not persisted in project files。
- logs do not contain secrets。
- plugin permission denied cases。
- IPC channel allowlist。
- renderer cannot directly access filesystem。

## 14. LLM Evaluation Policy

真实模型只用于离线基准评估，不进入 CI 强断言。

离线评估可以检查：

- 输出是否大致符合 schema。
- 风格一致性。
- 审稿质量。
- 上下文选择效果。

离线评估结果不得替代单元、契约和集成测试。

## 15. Data Flow

测试数据流：

```text
fixture / generated input
→ schema validation
→ module under test
→ structured result
→ assertion against contract
→ redaction and cleanup check
```

## 16. Module Relationship

- `schemas`：contract tests。
- `repository`：temp project integration tests。
- `llm-adapter`：mock provider tests。
- `workflow-engine`：state machine tests。
- `context-engine`：budget and trace tests。
- `agent-engine`：handoff and validation tests。
- `ui`：component state and a11y tests。
- `apps/desktop`：Playwright smoke tests。

## 17. Design Reasons

Novel Studio 的最大风险不是功能少，而是用户数据丢失、AI 行为不可复现、模型调用不可控、Prompt/Agent/Workflow 无版本保障。因此测试策略优先覆盖数据完整性、Schema 契约、Repository 写入、LLM mock、Workflow 状态机和 AI 应用确认链路。

真实 LLM 输出不可稳定复现，所以 CI 使用 mock/fixture；真实模型只用于离线评估。这直接落实宪法第14节。

## 18. Pros and Cons

### Pros

- CI 可复现。
- 高风险边界被优先覆盖。
- 真实模型成本和不稳定性不会污染测试。
- 数据恢复、历史和安全泄露有明确测试要求。

### Cons

- fixture 维护成本较高。
- Mock provider 需要认真设计，否则会产生虚假信心。
- Playwright 测试运行成本高于纯单元测试。
- 性能测试需要专门大项目 fixture。

## 19. Future Extensions

- Mutation testing for core engines。
- Property-based tests for schema migration。
- Golden trace tests for Context Engine。
- Visual regression tests for stable UI surfaces。
- Offline LLM benchmark suite。

## 20. Risk Analysis

| 风险                            | 涉及条款 | 影响             | 缓解方案                                                         |
| ------------------------------- | -------- | ---------------- | ---------------------------------------------------------------- |
| Mock 与真实 provider 行为差异大 | 第14节   | 线上模型路径出错 | provider fixture 来自脱敏真实错误样本，Adapter contract 保持严格 |
| Fixture 维护成本过高            | P10      | 测试被跳过或陈旧 | fixture 小型化，按模块归档，变更必须说明                         |
| E2E 过多导致 CI 慢              | P10      | 开发反馈慢       | E2E 只覆盖关键路径，详细状态用单元/集成测试                      |
| 覆盖率数字掩盖风险              | 第14节   | 关键边界漏测     | 明确 required test matrix                                        |
| 真实用户数据误入测试            | 第13节   | 隐私风险         | fixture review + secret scan                                     |

## 21. Phase 5 Changelog

- v1.0 - 2026-07-03：创建测试规范初稿。
- v1.0 - 2026-07-03：定义测试金字塔、Schema contract、Repository、Workflow、Context、Agent、LLM Adapter、UI、Plugin 边界测试。
- v1.0 - 2026-07-03：明确真实模型只用于离线评估，不作为 CI 强断言。

## 22. Progress Tracking

| 阶段                  | 状态             | 本次产出                                                          | 未决问题                                           | 下一步                               |
| --------------------- | ---------------- | ----------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| Phase 1 产品设计      | Complete         | `PRODUCT_PRD.md v1.0`                                             | v1 Provider 首批落地顺序仍需 ROADMAP 排序          | 已完成                               |
| Phase 2 系统架构      | Complete         | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md` | Workflow/Agent 层级解释需测试固化                  | 已完成                               |
| Phase 3 数据结构设计  | Complete         | `DATA_SCHEMA.md v1.0`                                             | JSON Schema 文件尚未生成                           | 已完成                               |
| Phase 4 UI/UX 设计    | Complete         | `UI_GUIDELINES.md v1.0`                                           | 组件和编辑器选型需 spike 验证                      | 已完成                               |
| Phase 5 开发规范      | Draft for Review | `CODING_STANDARDS.md v1.0`、`TESTING.md v1.0`                     | CI 配置、fixture 文件、coverage threshold 尚未实现 | 等待确认后进入 Phase 6 Task Planning |
| Phase 6 Task Planning | Not Started      | 无                                                                | 任务拆分、里程碑、风险缓冲                         | Phase 5 确认后启动                   |
| Phase 7 正式开发      | Not Started      | 无                                                                | 代码实现排期                                       | Phase 6 后启动                       |
