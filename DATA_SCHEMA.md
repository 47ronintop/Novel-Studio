# DATA SCHEMA — Novel Studio

Version: 1.0 | Status: Draft for Review | Phase: 3 Data Structure Design

## 1. 文档目的

本文定义 Novel Studio v1 的项目数据结构、文件布局、Schema 版本策略、核心实体、版本历史、崩溃恢复、缓存边界、迁移规则与数据完整性要求。本文受 `PROJECT_CONSTITUTION.md`、`PRODUCT_PRD.md`、`ARCHITECTURE.md` 和 `adr/ADR-0001-engine-runtime-language.md` 约束。

本文不定义 UI 组件、具体代码实现、Prompt 文案或正式任务拆分。

## 2. 数据设计原则

- 项目文件夹是真实数据源，SQLite 只作为可重建索引或 cache（P5、P7）。
- 人类可读优先：正文使用 Markdown，结构化资产使用 JSON。
- 所有结构化数据必须有 Schema、版本号和迁移策略。
- `history/` 与 `memories/` 是不可再生数据，不得被清缓存功能删除（第5节）。
- `cache/` 是唯一可安全清空并重建的目录。
- Prompt、Agent、Workflow 和模型配置是用户可编辑资产，关键资产必须保留版本历史（P3）。
- Agent handoff、Context bundle、Workflow result 必须是结构化 JSON（P9）。

## 3. 项目目录结构

```text
project/
├── project.json
├── settings.json
├── characters/
│   └── <character-id>.json
├── world/
│   ├── locations/
│   │   └── <location-id>.json
│   ├── factions/
│   │   └── <faction-id>.json
│   ├── rules/
│   │   └── <rule-id>.json
│   └── glossary/
│       └── <term-id>.json
├── outline/
│   ├── outline.json
│   └── arcs/
│       └── <arc-id>.json
├── timeline/
│   └── events.json
├── chapters/
│   └── <chapter-id>.md
├── history/
│   ├── chapters/
│   │   └── <chapter-id>/
│   │       └── <version-id>.md
│   ├── prompts/
│   │   └── <prompt-id>/
│   │       └── <version-id>.json
│   ├── agents/
│   │   └── <agent-id>/
│   │       └── <version-id>.json
│   ├── workflow/
│   │   └── <workflow-id>/
│   │       └── <version-id>.json
│   └── recovery/
│       └── <session-id>.json
├── memories/
│   ├── long-term/
│   │   └── <memory-id>.json
│   ├── style/
│   │   └── <memory-id>.json
│   └── summaries/
│       └── <summary-id>.json
├── prompts/
│   └── <prompt-id>.json
├── agents/
│   └── <agent-id>.json
├── workflow/
│   └── <workflow-id>.json
├── plugins/
│   └── plugins.json
└── cache/
    ├── indexes/
    ├── retrieval/
    └── novel-studio.sqlite
```

目录规则：

- 文件名使用 stable id，不使用标题直接作为文件名。
- 用户可见名称存放在 JSON 或 Markdown frontmatter 中。
- ID 一经创建不得因重命名而变化。
- 删除操作必须优先采用软删除或进入历史记录，具体 UI 行为在后续文档定义。

## 4. 通用字段约定

### 4.1 ID

所有核心实体使用字符串 ID：

```json
{
  "id": "chr_01JZ7P9QK2R6D4W8K3A1B5C9D0"
}
```

规则：

- ID 必须全项目唯一，建议使用带类型前缀的 ULID 或 UUID。
- ID 前缀用于人类排查，不作为业务类型判断的唯一依据。
- 引用其他实体时必须引用 ID，不引用文件路径或显示名称。

### 4.2 Metadata

核心实体必须包含：

```json
{
  "schemaVersion": "1.0",
  "id": "entity_id",
  "type": "entity_type",
  "title": "Human readable title",
  "status": "active",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

时间规则：

- 存储使用 ISO 8601 UTC。
- UI 可按用户地区显示本地时间。
- 不允许用本地化字符串作为持久化时间。

### 4.3 Entity Status

通用状态：

- `active`
- `draft`
- `archived`
- `deleted`

正文章节额外状态：

- `revision`
- `review`
- `done`

### 4.4 Data Class

每个文件必须能归类为：

- `source`：用户或用户确认后的真实数据。
- `user-generated`：用户直接创作内容。
- `ai-assisted`：AI 生成但经用户确认的数据。
- `system-generated`：系统生成、但不可随意删除的数据，如恢复记录。
- `derived-cache`：可从 source 重建的数据。

`history/`、`memories/` 不得标记为 `derived-cache`。

## 5. project.json

`project.json` 存放项目元信息，不存放明文密钥。

```json
{
  "schemaVersion": "1.0",
  "projectId": "prj_01JZ7P9QK2R6D4W8K3A1B5C9D0",
  "title": "Novel Title",
  "projectType": "novel",
  "language": "zh-CN",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "defaultWorkflowId": "wf_default_review",
  "defaultModelProfileId": "model_default",
  "stats": {
    "targetWordCount": 1000000,
    "currentWordCount": 0,
    "chapterCount": 0
  }
}
```

规则：

- `projectType` v1 默认为 `novel`，未来可扩展 `screenplay`、`comic-script`、`game-narrative`。
- `stats` 可由项目文件重算，不作为唯一事实来源。
- 不得存放 API Key 或 access token。

## 6. settings.json

`settings.json` 存放项目级配置，不存放明文密钥。

```json
{
  "schemaVersion": "1.0",
  "autosave": {
    "enabled": true,
    "intervalMs": 30000,
    "createHistorySnapshot": false
  },
  "history": {
    "snapshotPolicy": "manual-and-interval",
    "intervalMinutes": 10,
    "maxSnapshotsPerChapter": null
  },
  "models": {
    "defaultProfileId": "model_default",
    "profiles": [
      {
        "id": "model_default",
        "provider": "openai-compatible",
        "displayName": "Default Model",
        "baseUrl": "https://api.example.com/v1",
        "apiKeyRef": "secret://model_default/api_key",
        "modelName": "example-model",
        "temperature": 0.7,
        "maxTokens": 4096,
        "topP": 1,
        "timeoutMs": 60000,
        "frequencyPenalty": 0,
        "presencePenalty": 0
      }
    ]
  }
}
```

规则：

- `apiKeyRef` 是密钥引用，不是密钥值。
- 密钥存储机制在 `SECURITY.md` 细化。
- `snapshotPolicy` 可选值：`manual-only`、`interval-only`、`manual-and-interval`、`on-save-and-manual`。

## 7. Chapter Markdown

章节文件存放在 `chapters/<chapter-id>.md`。

```markdown
---
schemaVersion: "1.0"
id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0"
type: "chapter"
title: "第一章"
order: 1
status: "draft"
volumeId: "vol_01"
povCharacterIds:
  - "chr_hero"
locationIds:
  - "loc_capital"
timelineEventIds:
  - "evt_arrival"
tags:
  - "opening"
wordCount: 3200
createdAt: "2026-07-03T00:00:00.000Z"
updatedAt: "2026-07-03T00:00:00.000Z"
---

章节正文使用 Markdown。
```

规则：

- frontmatter 是结构化元数据，正文是 Markdown。
- `wordCount` 可重算，不作为唯一事实来源。
- 章节引用人物、地点、时间线时使用 ID。
- 正文中的自然语言不作为 Agent 间结构化 handoff。

## 8. Story Assets

### 8.1 Character

`characters/<character-id>.json`

```json
{
  "schemaVersion": "1.0",
  "id": "chr_hero",
  "type": "character",
  "title": "角色名",
  "status": "active",
  "aliases": ["别名"],
  "role": "protagonist",
  "summary": "角色摘要",
  "goals": ["外在目标", "内在目标"],
  "conflicts": ["主要冲突"],
  "arc": {
    "start": "初始状态",
    "turningPoints": ["转折点"],
    "end": "目标状态"
  },
  "relationships": [
    {
      "targetCharacterId": "chr_other",
      "relationshipType": "ally",
      "description": "关系说明"
    }
  ],
  "appearanceChapterIds": ["ch_01"],
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

### 8.2 World Asset

World asset 使用统一外壳，按目录区分地点、势力、规则、术语。

```json
{
  "schemaVersion": "1.0",
  "id": "loc_capital",
  "type": "world.location",
  "title": "地点名",
  "status": "active",
  "summary": "地点摘要",
  "details": {
    "geography": "地理",
    "culture": "文化",
    "constraints": ["规则或限制"]
  },
  "relatedEntityIds": ["chr_hero", "fac_empire"],
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

### 8.3 Outline

`outline/outline.json`

```json
{
  "schemaVersion": "1.0",
  "id": "outline_main",
  "type": "outline",
  "title": "主线大纲",
  "status": "active",
  "volumes": [
    {
      "id": "vol_01",
      "title": "第一卷",
      "summary": "卷摘要",
      "chapterIds": ["ch_01", "ch_02"]
    }
  ],
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

### 8.4 Timeline

`timeline/events.json`

```json
{
  "schemaVersion": "1.0",
  "type": "timeline.events",
  "events": [
    {
      "id": "evt_arrival",
      "title": "抵达",
      "sequence": 1,
      "timeLabel": "第一日",
      "summary": "事件摘要",
      "chapterIds": ["ch_01"],
      "characterIds": ["chr_hero"],
      "locationIds": ["loc_capital"],
      "causes": [],
      "effects": ["evt_conflict"]
    }
  ],
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

## 9. Memories

`memories/` 存放不可随意重建的长期记忆、风格记忆和摘要。AI 生成内容必须经过用户确认，或明确标记为未确认。

```json
{
  "schemaVersion": "1.0",
  "id": "mem_01",
  "type": "memory.long-term",
  "title": "主角核心动机",
  "status": "active",
  "origin": "user-confirmed-ai",
  "confidence": "confirmed",
  "content": "记忆内容",
  "sourceRefs": [
    {
      "entityType": "chapter",
      "entityId": "ch_01",
      "range": {
        "startLine": 10,
        "endLine": 28
      }
    }
  ],
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- `origin` 可选：`user`、`user-confirmed-ai`、`ai-unconfirmed`。
- `confidence` 可选：`confirmed`、`needs-review`、`deprecated`。
- `ai-unconfirmed` 不得默认进入高置信上下文。

## 10. Prompt Template

`prompts/<prompt-id>.json`

```json
{
  "schemaVersion": "1.0",
  "id": "prompt_writer_default",
  "type": "prompt.template",
  "title": "默认写作 Prompt",
  "status": "active",
  "promptRole": "writer",
  "template": "请根据 {{context.goal}} 写作。",
  "variables": [
    {
      "name": "context.goal",
      "required": true,
      "type": "string"
    }
  ],
  "conditionalBlocks": [
    {
      "name": "style_memory",
      "condition": "hasStyleMemory",
      "content": "{{styleMemory}}"
    }
  ],
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- Prompt 不得硬编码在业务代码中。
- Prompt 修改必须生成版本记录。
- 模板语法的最终表达式规则在 `PROMPT_SYSTEM.md` 中细化。

## 11. Agent Config

`agents/<agent-id>.json`

```json
{
  "schemaVersion": "1.0",
  "id": "agent_reviewer_default",
  "type": "agent.config",
  "title": "默认审稿 Agent",
  "status": "active",
  "agentRole": "reviewer",
  "promptTemplateId": "prompt_reviewer_default",
  "inputSchemaId": "schema.agent.reviewer.input.v1",
  "outputSchemaId": "schema.agent.reviewer.output.v1",
  "modelProfileId": "model_default",
  "tools": [],
  "limits": {
    "maxRetries": 2,
    "timeoutMs": 90000
  },
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- Agent 必须声明输入和输出 Schema。
- Agent 输出必须通过 Schema 校验。
- Agent 不得直接写项目资产。

## 12. Workflow Definition

`workflow/<workflow-id>.json`

```json
{
  "schemaVersion": "1.0",
  "id": "wf_review_chapter",
  "type": "workflow.definition",
  "title": "审稿当前章节",
  "status": "active",
  "entryStepId": "step_build_context",
  "steps": [
    {
      "id": "step_build_context",
      "kind": "context",
      "contextPolicyId": "ctx_review_chapter",
      "nextStepId": "step_review"
    },
    {
      "id": "step_review",
      "kind": "agent",
      "agentId": "agent_reviewer_default",
      "inputFrom": "step_build_context",
      "nextStepId": "step_user_confirm"
    },
    {
      "id": "step_user_confirm",
      "kind": "user-confirmation",
      "required": true,
      "nextStepId": null
    }
  ],
  "failurePolicy": {
    "onValidationError": "stop",
    "onModelError": "retry-then-stop",
    "maxRetries": 2
  },
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- Workflow 定义步骤顺序与状态机。
- `kind: "agent"` 步骤引用 Agent，但不把 Agent 输出作为自然语言字符串传递。
- 用户确认步骤用于保证 AI 输出进入正式资产前经过用户决策。

## 13. Context Bundle

Context Bundle 是运行时结构化数据，可记录到 `history/recovery/` 或运行日志索引中，具体存储策略在 Context Engine 文档细化。

```json
{
  "schemaVersion": "1.0",
  "id": "ctxrun_01",
  "type": "context.bundle",
  "workflowRunId": "run_01",
  "budget": {
    "maxTokens": 12000,
    "allocatedTokens": 9000,
    "reservedOutputTokens": 3000
  },
  "sections": [
    {
      "kind": "chapter_excerpt",
      "entityId": "ch_01",
      "tokenEstimate": 1800,
      "contentRef": {
        "strategy": "inline",
        "value": "上下文片段"
      }
    },
    {
      "kind": "memory",
      "entityId": "mem_01",
      "tokenEstimate": 200,
      "contentRef": {
        "strategy": "inline",
        "value": "记忆内容"
      }
    }
  ],
  "trace": {
    "selectionReason": "review current chapter",
    "excludedRefs": [
      {
        "entityId": "ch_99",
        "reason": "budget_exceeded"
      }
    ]
  }
}
```

规则：

- Context Engine 不得无差别塞入全部正文。
- `trace` 必须支持调试和回放。
- token 统计可以估算，但必须标记为 estimate 或 actual。

## 14. Agent Handoff

Agent handoff 是 Agent 间正式契约，必须为 JSON。

```json
{
  "schemaVersion": "1.0",
  "handoffId": "handoff_01",
  "fromAgentId": "agent_planner_default",
  "toAgentId": "agent_writer_default",
  "workflowRunId": "run_01",
  "payloadType": "chapter_plan",
  "payload": {
    "goal": "完成下一章规划",
    "beats": [
      {
        "order": 1,
        "summary": "开场冲突"
      }
    ]
  },
  "createdAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- 不得用拼接自然语言字符串作为 Agent 间正式状态传递。
- UI 可展示流式 token，但流式 token 不构成 handoff。
- `payloadType` 必须映射到明确 Schema。

## 15. LLM Request / Response

LLM Adapter 输入：

```json
{
  "schemaVersion": "1.0",
  "requestId": "llmreq_01",
  "modelProfileId": "model_default",
  "mode": "non-streaming",
  "messages": [
    {
      "role": "system",
      "content": "system prompt"
    },
    {
      "role": "user",
      "content": "user prompt"
    }
  ],
  "parameters": {
    "temperature": 0.7,
    "maxTokens": 4096,
    "topP": 1
  },
  "responseFormat": {
    "type": "json_schema",
    "schemaId": "schema.agent.reviewer.output.v1"
  }
}
```

LLM Adapter 输出：

```json
{
  "schemaVersion": "1.0",
  "requestId": "llmreq_01",
  "provider": "openai-compatible",
  "modelName": "example-model",
  "status": "success",
  "content": {
    "type": "json",
    "value": {}
  },
  "usage": {
    "inputTokens": 1000,
    "outputTokens": 500,
    "totalTokens": 1500,
    "estimatedCost": {
      "amount": 0.01,
      "currency": "USD"
    }
  },
  "createdAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- Provider 原始错误必须归一化。
- usage 可以为估算，但必须显式标记缺失或估算状态。
- 明文 API Key 不得出现在 request/response/log 中。

## 16. Unified Error

```json
{
  "schemaVersion": "1.0",
  "errorId": "err_01",
  "code": "LLM_RATE_LIMITED",
  "category": "LLMAdapterError",
  "message": "模型服务限流，请稍后重试。",
  "recoverability": "retryable",
  "suggestedAction": "retry_with_backoff",
  "traceId": "trace_01",
  "redactedDetail": {
    "provider": "openai-compatible",
    "httpStatus": 429
  },
  "createdAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- 错误必须稳定编码。
- `redactedDetail` 不得包含明文密钥或完整敏感内容。
- UI 展示使用 `message` 和 `suggestedAction`。

## 17. Version Record

版本历史用于章节、Prompt、Agent、Workflow。文件放在 `history/<asset-type>/<asset-id>/<version-id>.<ext>`。

JSON 资产版本记录：

```json
{
  "schemaVersion": "1.0",
  "versionId": "ver_01",
  "assetType": "prompt",
  "assetId": "prompt_writer_default",
  "reason": "manual-save",
  "createdBy": "user",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "parentVersionId": "ver_00",
  "checksum": "sha256:...",
  "snapshot": {}
}
```

章节版本记录使用 Markdown 文件，frontmatter 包含：

```yaml
schemaVersion: "1.0"
versionId: "ver_01"
assetType: "chapter"
assetId: "ch_01"
reason: "autosave-snapshot"
createdBy: "system"
createdAt: "2026-07-03T00:00:00.000Z"
parentVersionId: "ver_00"
checksum: "sha256:..."
```

版本原因：

- `manual-save`
- `autosave-snapshot`
- `interval-snapshot`
- `before-ai-apply`
- `before-rollback`
- `migration`

规则：

- 回滚前必须创建 `before-rollback` 快照。
- AI 建议写入正式资产前必须创建 `before-ai-apply` 快照。
- 历史快照不得放入 `cache/`。

## 18. Recovery Record

崩溃恢复记录存放于 `history/recovery/<session-id>.json`。

```json
{
  "schemaVersion": "1.0",
  "sessionId": "session_01",
  "projectId": "prj_01",
  "openAssetId": "ch_01",
  "assetType": "chapter",
  "dirty": true,
  "lastPersistedVersionId": "ver_01",
  "draftContentRef": {
    "strategy": "inline",
    "content": "未保存正文"
  },
  "cursor": {
    "line": 12,
    "column": 4
  },
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

规则：

- Recovery Record 是不可再生数据，归入 `history/`。
- 恢复成功后不得立即删除记录，应标记状态或延迟清理，避免误恢复失败。
- 恢复记录不得包含明文 API Key。

## 19. Cache / SQLite

`cache/` 只存放可重建数据。

可放入 cache 的内容：

- 向量索引
- 全文检索索引
- 文件扫描索引
- token 估算缓存
- LLM response 临时调试索引，前提是不含敏感密钥且可清除

不得只存在 cache 的内容：

- 章节正文
- 人物/世界观/大纲/时间线真实资产
- Prompt/Agent/Workflow 当前配置
- 版本历史
- 长期记忆
- 崩溃恢复记录

SQLite 规则：

- SQLite 文件建议为 `cache/novel-studio.sqlite`。
- SQLite schema 可随版本重建。
- SQLite 中的记录必须能从项目文件夹源数据恢复。
- 清理 cache 不得影响项目打开、阅读和基础编辑。

## 20. Schema Versioning and Migration

Schema version 使用语义化主版本：

- `1.0`：v1 初始 Schema。
- 小版本兼容新增字段。
- 主版本变化需要迁移策略。

迁移规则：

- 迁移前必须创建备份或版本记录。
- 迁移不得删除未知字段，除非迁移规则明确说明。
- 迁移失败必须可回滚。
- 迁移记录应写入 migration log，具体位置在 Phase 5/实现规划中细化。

兼容策略：

- 读取时允许保留未知字段。
- 写入时必须按当前 Schema 输出。
- UI 不得静默丢弃无法识别的用户数据。

## 21. Repository Write Semantics

Repository 写入必须遵循：

- validate before write
- write temp file
- fsync when available
- atomic rename
- update index/cache after source write
- create version record when policy requires

写入失败：

- 不得留下半写入正式文件。
- 应保留恢复信息。
- 应返回 Unified Error。

并发：

- v1 不支持实时多人协作。
- 同一项目多窗口编辑需要锁或冲突检测，具体策略在后续实现规划中细化。

## 22. 数据流

### 22.1 写作保存流

```text
Editor draft
→ ChapterFrontmatter validation
→ RecoveryRecord update
→ Chapter file atomic write
→ optional VersionRecord snapshot
→ cache index invalidation
```

### 22.2 AI 建议应用流

```text
Workflow result JSON
→ Agent output schema validation
→ user confirmation
→ before-ai-apply VersionRecord
→ target asset update
→ cache index invalidation
```

### 22.3 Prompt 修改流

```text
Prompt draft
→ PromptTemplate schema validation
→ current prompt version snapshot
→ active prompt write
→ workflow compatibility check
```

### 22.4 Cache 重建流

```text
source files scan
→ schema validation
→ index extraction
→ SQLite/cache write
→ health summary
```

## 23. 模块关系

数据 Schema 与架构模块关系：

- Frontend：只消费 Application DTO，不直接操作文件 Schema。
- Application Layer：调用 Service 用例，不执行文件写入。
- Service Layer：协调 Repository、Agent、Context、Workflow 的数据输入输出。
- Agent Engine：依赖 Agent input/output schema 和 Handoff schema。
- Context Engine：依赖 Context Bundle、Memory、Story Asset、Chapter schema。
- Workflow Engine：依赖 Workflow Definition、Step Result、Handoff schema。
- LLM Adapter：依赖 LLM Request/Response、Unified Error、Model Profile schema。
- Repository：负责所有文件 Schema 的读写、校验、迁移和缓存失效。
- Storage：只保存文件和 cache，不承载业务逻辑。

## 24. 设计原因

采用 Markdown + frontmatter 存章节，是为了兼顾人类可读、Git diff、文本编辑器兼容与结构化元数据。采用 JSON 存结构化资产，是为了 Schema 校验、跨层契约、迁移和 Agent handoff。将 SQLite 限定为 `cache/`，是为了避免索引层篡位为唯一真实数据源，保持 P5/P7 的本地可迁移原则。

将 `history/` 与 `memories/` 明确为不可再生数据，是为了避免“清缓存”误删用户创作过程、确认记忆和恢复状态。将 Prompt、Agent、Workflow 纳入版本记录，是为了落实 P3，并为未来高级用户自定义创作系统打基础。

## 25. 优缺点

### 优点

- 文件可读、可迁移、可 Git 管理。
- 用户正文和结构化资产都有清晰所有权。
- cache 损坏不影响核心数据。
- 版本历史和恢复数据具备明确落点。
- Agent/Workflow/LLM 契约可测试、可回放。

### 缺点

- 相比单一数据库，跨文件引用和一致性校验更复杂。
- 大项目扫描和索引需要额外 cache 机制。
- Markdown frontmatter 需要严格校验，避免用户手工编辑破坏结构。
- 原子写入、锁和恢复策略需要 Repository 层认真实现。

## 26. 未来扩展方案

- 项目类型扩展：通过 `projectType`、资产 type 和 Workflow 模板扩展剧本、漫画脚本、游戏剧情。
- 云同步：保留文件源数据，未来增加 Sync Adapter，不改变真实数据源。
- 多人协作：未来通过 RFC 评估 CRDT、Git-based workflow 或锁模型。
- 插件数据：插件必须声明自己的数据目录和 Schema，不能直接污染核心资产。
- 向量检索：向量索引可存入 `cache/`，并通过源文件 checksum 判断是否需要重建。

## 27. 风险分析

| 风险                            | 涉及条款  | 影响                              | 缓解方案                                        |
| ------------------------------- | --------- | --------------------------------- | ----------------------------------------------- |
| JSON 文件之间引用失效           | P7、第4节 | UI 和 AI 上下文可能引用不存在资产 | Repository 提供 referential integrity check     |
| Markdown frontmatter 被手工破坏 | P7        | 章节无法解析                      | 打开项目时诊断并提供修复建议，不覆盖正文        |
| history 体积过大                | 第5节     | 项目膨胀、Git 管理困难            | 提供归档策略，但不得默认清理不可再生历史        |
| cache 与源文件不一致            | 第4节     | 检索结果错误                      | cache 记录 source checksum，失配时重建          |
| API Key 误入 settings 或日志    | 第13节    | 隐私与安全风险                    | Schema 禁止明文字段，日志脱敏在 SECURITY 中细化 |
| AI 未确认记忆进入高置信上下文   | P1、第8节 | 污染设定和输出                    | memory confidence 必须参与 Context 策略         |

## 28. Phase 3 Changelog

- v1.0 - 2026-07-03：创建数据结构设计初稿。
- v1.0 - 2026-07-03：定义项目目录、核心实体、章节 frontmatter、Prompt/Agent/Workflow、Context Bundle、Agent Handoff、LLM Request/Response、Unified Error、Version Record、Recovery Record。
- v1.0 - 2026-07-03：明确 SQLite 仅作为 `cache/` 下可重建索引层。

## 29. Progress Tracking

| 阶段                  | 状态             | 本次产出                                                          | 未决问题                                                                   | 下一步                            |
| --------------------- | ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| Phase 1 产品设计      | Complete         | `PRODUCT_PRD.md v1.0`                                             | v1 Provider 首批落地顺序仍需 ROADMAP 排序                                  | 已完成                            |
| Phase 2 系统架构      | Complete         | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md` | Workflow/Agent 层级解释需在测试规范中固化                                  | 已完成                            |
| Phase 3 数据结构设计  | Draft for Review | `DATA_SCHEMA.md v1.0`                                             | Schema 具体 JSON Schema 文件尚未生成；锁策略和迁移日志路径需在后续规划细化 | 等待确认后进入 Phase 4 UI/UX 设计 |
| Phase 4 UI/UX 设计    | Not Started      | 无                                                                | 默认布局、信息密度、命令体系、编辑器交互                                   | Phase 3 确认后启动                |
| Phase 5 开发规范      | Not Started      | 无                                                                | Monorepo 工具链、lint/type/test/CI 规则                                    | Phase 4 后启动                    |
| Phase 6 Task Planning | Not Started      | 无                                                                | 任务拆分、里程碑、风险缓冲                                                 | Phase 5 后启动                    |
| Phase 7 正式开发      | Not Started      | 无                                                                | 代码实现排期                                                               | Phase 6 后启动                    |
