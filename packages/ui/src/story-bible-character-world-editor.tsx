import type { JsonObject } from "@novel-studio/shared";

import {
  StoryBibleReferenceSelector,
  storyBibleEntryReferenceOptions,
  type StoryBibleReferenceOption
} from "./story-bible-reference-selector.js";
import { StoryBibleRelationsField } from "./story-bible-relations-field.js";
import type {
  StoryBibleEditorEntry,
  StoryBibleEditorProps,
  StoryBibleWorldAssetType
} from "./workspace-shell-types.js";

type VariantMode = "text" | "lines" | "structured";

export function CharacterDetailFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "character") return null;
  const details = editor.draft.details;
  const goalsValue = details["goals"];
  const legacyGoals = stringArray(goalsValue);
  const goals = objectValue(goalsValue);
  const conflicts = stringArray(details["conflicts"]);
  const arc = objectValue(details["arc"]);
  const updateDetails = (patch: JsonObject) =>
    editor.onDraftChange("character", { details: patch });

  return (
    <>
      <div className="ns-story-form-grid ns-story-form-grid-compact">
        <TextInput
          ariaLabel="人物姓名"
          label="姓名"
          onChange={(title) => editor.onDraftChange("character", { title })}
          value={editor.draft.title}
        />
        <TextInput
          ariaLabel="身份定位"
          label="身份定位"
          onChange={(role) => updateDetails({ role })}
          value={stringValue(details["role"])}
        />
        <TextArea
          ariaLabel="人物简介"
          label="简介"
          onChange={(summary) => editor.onDraftChange("character", { summary })}
          value={editor.draft.summary}
          wide
        />
        <TextArea
          ariaLabel="外在目标"
          label="外在目标"
          onChange={(external) => updateDetails({ goals: { ...goals, external } })}
          value={stringValue(goals["external"]) || legacyGoals[0] || ""}
        />
        <TextArea
          ariaLabel="内在目标"
          label="内在目标"
          onChange={(internal) => updateDetails({ goals: { ...goals, internal } })}
          value={stringValue(goals["internal"]) || legacyGoals[1] || ""}
        />
        <LinesField
          ariaLabel="主要冲突"
          label="主要冲突"
          onChange={(value) => updateDetails({ conflicts: value })}
          value={conflicts}
          wide
        />
        <TextArea
          ariaLabel="人物弧起点"
          label="人物弧起点"
          onChange={(start) => updateDetails({ arc: { ...arc, start } })}
          value={stringValue(arc["start"])}
        />
        <TextArea
          ariaLabel="人物弧目标状态"
          label="人物弧目标状态"
          onChange={(targetState) => updateDetails({ arc: { ...arc, targetState } })}
          value={stringValue(arc["targetState"]) || stringValue(arc["end"])}
        />
        <LinesField
          ariaLabel="人物弧转折"
          label="人物弧转折"
          onChange={(turningPoints) => updateDetails({ arc: { ...arc, turningPoints } })}
          value={stringArray(arc["turningPoints"])}
          wide
        />
        <StoryBibleRelationsField editor={editor} label="关联人物与资料" />
      </div>

      <details className="ns-story-supplemental">
        <summary>补充设定</summary>
        <div className="ns-story-form-grid ns-story-form-grid-compact">
          <PersonalityFields details={details} onChange={updateDetails} />
          <VoiceFields details={details} onChange={updateDetails} />
          <LinesField
            ariaLabel="人物能力"
            label="能力（每行一项）"
            onChange={(abilities) => updateDetails({ abilities })}
            value={stringArray(details["abilities"])}
            wide
          />
          <LinesField
            ariaLabel="人物限制"
            label="限制（每行一项）"
            onChange={(limitations) => updateDetails({ limitations })}
            value={stringArray(details["limitations"])}
            wide
          />
          <CurrentStateFields editor={editor} onChange={updateDetails} />
          <SecretsEditor editor={editor} onChange={updateDetails} />
          <KnowledgeStatesEditor editor={editor} onChange={updateDetails} />
          <StateHistoryEditor
            ariaLabel="人物状态历史"
            items={recordArray(details["stateHistory"])}
            onChange={(stateHistory) => updateDetails({ stateHistory })}
            editor={editor}
          />
          <StatusField editor={editor} />
          <AliasesField editor={editor} />
        </div>
      </details>
    </>
  );
}

export function WorldDetailFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "world") return null;
  const updateDetails = (patch: JsonObject) => editor.onDraftChange("world", { details: patch });

  return (
    <div className="ns-story-form-grid ns-story-form-grid-compact">
      <TextInput
        ariaLabel="世界观标题"
        label="标题"
        onChange={(title) => editor.onDraftChange("world", { title })}
        value={editor.draft.title}
      />
      <label className="ns-story-field">
        <span>类型</span>
        <select
          aria-label="世界观类型"
          disabled={editor.draft.id !== undefined}
          onChange={(event) =>
            editor.onDraftChange("world", {
              assetType: event.currentTarget.value as StoryBibleWorldAssetType
            })
          }
          value={editor.draft.assetType}
        >
          {WORLD_ASSET_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <TextArea
        ariaLabel="世界观摘要"
        label="摘要"
        onChange={(summary) => editor.onDraftChange("world", { summary })}
        value={editor.draft.summary}
        wide
      />
      <WorldStrictDetailFields editor={editor} onChange={updateDetails} />
      <AliasesField editor={editor} />
      <StoryBibleRelationsField editor={editor} />
      <StatusField editor={editor} />
    </div>
  );
}

const WORLD_ASSET_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: StoryBibleWorldAssetType;
  readonly label: string;
}> = [
  { value: "world.location", label: "地点" },
  { value: "world.faction", label: "势力" },
  { value: "world.rule", label: "规则" },
  { value: "world.glossary", label: "术语" },
  { value: "world.item", label: "物品" },
  { value: "world.lore", label: "背景资料" }
];

function PersonalityFields({
  details,
  onChange
}: {
  readonly details: JsonObject;
  readonly onChange: (patch: JsonObject) => void;
}) {
  const value = details["personality"];
  const mode: VariantMode = isObject(value)
    ? "structured"
    : Array.isArray(value)
      ? "lines"
      : "text";
  const structured = objectValue(value);
  const changeMode = (nextMode: VariantMode) => {
    if (nextMode === mode) return;
    const text = typeof value === "string" ? value : stringArray(value).join("\n");
    if (nextMode === "text") {
      onChange({
        personality: mode === "structured" ? stringArray(structured["traits"]).join("、") : text
      });
    } else if (nextMode === "lines") {
      onChange({
        personality: mode === "structured" ? stringArray(structured["traits"]) : splitLines(text)
      });
    } else {
      onChange({
        personality: {
          traits: mode === "lines" ? stringArray(value) : splitLines(text),
          values: [],
          fears: [],
          desires: []
        }
      });
    }
  };

  return (
    <FieldSection ariaLabel="人物性格设定" title="性格">
      <VariantModeField
        ariaLabel="性格记录方式"
        modes={[
          ["text", "描述"],
          ["lines", "标签"],
          ["structured", "结构化"]
        ]}
        onChange={changeMode}
        value={mode}
      />
      {mode === "text" ? (
        <TextArea
          ariaLabel="性格描述"
          label="性格描述"
          onChange={(personality) => onChange({ personality })}
          value={stringValue(value)}
          wide
        />
      ) : mode === "lines" ? (
        <LinesField
          ariaLabel="性格标签"
          label="性格标签（每行一项）"
          onChange={(personality) => onChange({ personality })}
          value={stringArray(value)}
          wide
        />
      ) : (
        <>
          {(
            [
              ["traits", "性格特质"],
              ["values", "价值观"],
              ["fears", "恐惧"],
              ["desires", "欲望"]
            ] as const
          ).map(([key, label]) => (
            <LinesField
              ariaLabel={label}
              key={key}
              label={`${label}（每行一项）`}
              onChange={(items) => onChange({ personality: { ...structured, [key]: items } })}
              value={stringArray(structured[key])}
              wide
            />
          ))}
        </>
      )}
    </FieldSection>
  );
}

function VoiceFields({
  details,
  onChange
}: {
  readonly details: JsonObject;
  readonly onChange: (patch: JsonObject) => void;
}) {
  const value = details["voice"];
  const mode: VariantMode = isObject(value) ? "structured" : "text";
  const structured = objectValue(value);
  const changeMode = (nextMode: VariantMode) => {
    if (nextMode === mode) return;
    if (nextMode === "structured") {
      onChange({
        voice: {
          tone: stringValue(value),
          vocabulary: [],
          catchphrases: [],
          forbiddenExpressions: []
        }
      });
    } else {
      onChange({ voice: stringValue(structured["tone"]) });
    }
  };

  return (
    <FieldSection ariaLabel="人物语言风格设定" title="语言风格">
      <VariantModeField
        ariaLabel="语言风格记录方式"
        modes={[
          ["text", "描述"],
          ["structured", "结构化"]
        ]}
        onChange={changeMode}
        value={mode}
      />
      {mode === "text" ? (
        <TextArea
          ariaLabel="语言风格描述"
          label="语言风格描述"
          onChange={(voice) => onChange({ voice })}
          value={stringValue(value)}
          wide
        />
      ) : (
        <>
          <TextArea
            ariaLabel="说话语气"
            label="说话语气"
            onChange={(tone) => onChange({ voice: { ...structured, tone } })}
            value={stringValue(structured["tone"])}
            wide
          />
          {(
            [
              ["vocabulary", "常用词汇"],
              ["catchphrases", "口头禅"],
              ["forbiddenExpressions", "禁用表达"]
            ] as const
          ).map(([key, label]) => (
            <LinesField
              ariaLabel={label}
              key={key}
              label={`${label}（每行一项）`}
              onChange={(items) => onChange({ voice: { ...structured, [key]: items } })}
              value={stringArray(structured[key])}
              wide
            />
          ))}
        </>
      )}
    </FieldSection>
  );
}

function CurrentStateFields({
  editor,
  onChange
}: {
  readonly editor: StoryBibleEditorProps;
  readonly onChange: (patch: JsonObject) => void;
}) {
  const state = objectValue(editor.draft.details["currentState"]);
  const patch = (value: JsonObject) => onChange({ currentState: { ...state, ...value } });
  return (
    <FieldSection ariaLabel="人物当前状态" title="当前状态">
      <SingleReferenceField
        ariaLabel="人物当前位置"
        label="当前位置"
        onChange={(locationId) => patch({ locationId })}
        options={entryOptions(editor, (entry) => entry.assetType === "world.location")}
        value={nullableString(state["locationId"])}
      />
      <TextArea
        ariaLabel="人物身体状态"
        label="身体状态"
        onChange={(physical) => patch({ physical })}
        value={stringValue(state["physical"])}
      />
      <TextArea
        ariaLabel="人物情绪状态"
        label="情绪状态"
        onChange={(emotional) => patch({ emotional })}
        value={stringValue(state["emotional"])}
      />
      <MultiReferenceField
        ariaLabel="人物持有物品"
        label="持有物品"
        onChange={(heldItemIds) => patch({ heldItemIds })}
        options={entryOptions(editor, (entry) => entry.assetType === "world.item")}
        value={stringArray(state["heldItemIds"])}
      />
      <SingleChapterField
        ariaLabel="人物状态截止章节"
        editor={editor}
        label="状态截止章节"
        onChange={(asOfChapterId) => patch({ asOfChapterId })}
        value={nullableString(state["asOfChapterId"])}
      />
      <SingleEventField
        ariaLabel="人物状态截止事件"
        editor={editor}
        label="状态截止事件"
        onChange={(asOfEventId) => patch({ asOfEventId })}
        value={nullableString(state["asOfEventId"])}
      />
    </FieldSection>
  );
}

function SecretsEditor({
  editor,
  onChange
}: {
  readonly editor: StoryBibleEditorProps;
  readonly onChange: (patch: JsonObject) => void;
}) {
  const items = recordArray(editor.draft.details["secrets"]);
  const options = entryOptions(editor, (entry) => entry.id !== editor.draft.id);
  const update = (index: number, patch: JsonObject) =>
    onChange({ secrets: replaceRecord(items, index, patch) });
  return (
    <FieldSection ariaLabel="人物秘密" title="秘密">
      {items.map((item, index) => (
        <RecordCard
          {...optionalProp("id", optionalString(item["secretId"]))}
          index={index}
          key={recordKey(item, "secretId", index)}
          label="秘密"
          onRemove={() => onChange({ secrets: removeRecord(items, index) })}
        >
          <TextArea
            ariaLabel={`秘密内容 ${index + 1}`}
            label="内容"
            onChange={(content) => update(index, { content })}
            value={stringValue(item["content"])}
            wide
          />
          <MultiReferenceField
            ariaLabel={`秘密知情者 ${index + 1}`}
            label="知情者"
            onChange={(knownByIds) => update(index, { knownByIds })}
            options={options}
            value={stringArray(item["knownByIds"])}
          />
          <SelectField
            ariaLabel={`秘密揭示状态 ${index + 1}`}
            label="揭示状态"
            onChange={(revealStatus) => update(index, { revealStatus })}
            options={[
              ["hidden", "隐藏"],
              ["partial", "部分揭示"],
              ["revealed", "已揭示"]
            ]}
            value={enumValue(item["revealStatus"], ["hidden", "partial", "revealed"], "hidden")}
          />
        </RecordCard>
      ))}
      <AddRecordButton
        ariaLabel="新增人物秘密"
        label="新增秘密"
        onClick={() =>
          onChange({
            secrets: [...items, { content: "新秘密", knownByIds: [], revealStatus: "hidden" }]
          })
        }
      />
    </FieldSection>
  );
}

function KnowledgeStatesEditor({
  editor,
  onChange
}: {
  readonly editor: StoryBibleEditorProps;
  readonly onChange: (patch: JsonObject) => void;
}) {
  const items = recordArray(editor.draft.details["knowledgeStates"]);
  const update = (index: number, patch: JsonObject) =>
    onChange({ knowledgeStates: replaceRecord(items, index, patch) });
  return (
    <FieldSection ariaLabel="人物知识状态" title="知识状态">
      {items.map((item, index) => (
        <RecordCard
          {...optionalProp("id", optionalString(item["knowledgeStateId"]))}
          index={index}
          key={recordKey(item, "knowledgeStateId", index)}
          label="知识"
          onRemove={() => onChange({ knowledgeStates: removeRecord(items, index) })}
          revision={positiveInteger(item["entryRevision"])}
        >
          <TextArea
            ariaLabel={`知识主题 ${index + 1}`}
            label="主题"
            onChange={(subject) => update(index, { subject })}
            value={stringValue(item["subject"])}
            wide
          />
          <SelectField
            ariaLabel={`知识认知状态 ${index + 1}`}
            label="认知状态"
            onChange={(state) => update(index, { state })}
            options={[
              ["known", "已知"],
              ["believed", "相信"],
              ["suspected", "怀疑"],
              ["misunderstood", "误解"],
              ["forgotten", "遗忘"]
            ]}
            value={enumValue(
              item["state"],
              ["known", "believed", "suspected", "misunderstood", "forgotten"],
              "known"
            )}
          />
          <SingleChapterField
            ariaLabel={`知识来源章节 ${index + 1}`}
            editor={editor}
            label="来源章节"
            onChange={(sourceChapterId) => update(index, { sourceChapterId })}
            value={nullableString(item["sourceChapterId"])}
          />
          <SingleChapterField
            ariaLabel={`知识生效章节 ${index + 1}`}
            editor={editor}
            label="生效章节"
            onChange={(validFromChapterId) => update(index, { validFromChapterId })}
            value={nullableString(item["validFromChapterId"])}
          />
          <SingleChapterField
            ariaLabel={`知识失效章节 ${index + 1}`}
            editor={editor}
            label="失效章节"
            onChange={(validToChapterId) => update(index, { validToChapterId })}
            value={nullableString(item["validToChapterId"])}
          />
          <TextArea
            ariaLabel={`知识备注 ${index + 1}`}
            label="备注"
            onChange={(note) => update(index, { note })}
            value={stringValue(item["note"])}
            wide
          />
        </RecordCard>
      ))}
      <AddRecordButton
        ariaLabel="新增人物知识状态"
        label="新增知识状态"
        onClick={() =>
          onChange({
            knowledgeStates: [
              ...items,
              {
                entryRevision: 1,
                subject: "新知识",
                state: "known",
                sourceChapterId: null,
                validFromChapterId: null,
                validToChapterId: null,
                note: ""
              }
            ]
          })
        }
      />
    </FieldSection>
  );
}

function StateHistoryEditor({
  ariaLabel,
  editor,
  items,
  onChange
}: {
  readonly ariaLabel: string;
  readonly editor: StoryBibleEditorProps;
  readonly items: readonly JsonObject[];
  readonly onChange: (items: JsonObject[]) => void;
}) {
  const events = timelineEventOptions(editor);
  const update = (index: number, patch: JsonObject) => onChange(replaceRecord(items, index, patch));
  return (
    <FieldSection ariaLabel={ariaLabel} title="状态历史">
      {items.map((item, index) => (
        <RecordCard
          {...optionalProp("id", optionalString(item["stateHistoryId"]))}
          index={index}
          key={recordKey(item, "stateHistoryId", index)}
          label="状态记录"
          onRemove={() => onChange(removeRecord(items, index))}
          revision={positiveInteger(item["entryRevision"])}
        >
          <SingleReferenceField
            ariaLabel={`状态历史事件 ${index + 1}`}
            label="时间线事件"
            onChange={(timelineEventId) =>
              timelineEventId === null ? undefined : update(index, { timelineEventId })
            }
            options={events}
            required
            value={nullableString(item["timelineEventId"])}
          />
          <SingleChapterField
            ariaLabel={`状态历史章节 ${index + 1}`}
            editor={editor}
            label="章节"
            onChange={(chapterId) => update(index, { chapterId })}
            value={nullableString(item["chapterId"])}
          />
          <TextArea
            ariaLabel={`状态历史备注 ${index + 1}`}
            label="变化说明"
            onChange={(note) => update(index, { note })}
            value={stringValue(item["note"])}
            wide
          />
        </RecordCard>
      ))}
      <AddRecordButton
        ariaLabel={`新增${ariaLabel}`}
        disabled={events.length === 0}
        label={events.length === 0 ? "需先创建时间线事件" : "新增状态记录"}
        onClick={() => {
          const firstEvent = events[0];
          if (firstEvent === undefined) return;
          onChange([
            ...items,
            {
              entryRevision: 1,
              timelineEventId: firstEvent.id,
              chapterId: null,
              note: ""
            }
          ]);
        }}
      />
    </FieldSection>
  );
}

function WorldStrictDetailFields({
  editor,
  onChange
}: {
  readonly editor: StoryBibleEditorProps;
  readonly onChange: (patch: JsonObject) => void;
}) {
  if (editor.draft.kind !== "world") return null;
  const details = editor.draft.details;
  const text = (key: string, label: string) => (
    <TextArea
      ariaLabel={label}
      key={key}
      label={label}
      onChange={(value) => onChange({ [key]: value })}
      value={stringValue(details[key])}
      wide
    />
  );
  const lines = (key: string, label: string) => (
    <LinesField
      ariaLabel={label}
      key={key}
      label={`${label}（每行一项）`}
      onChange={(value) => onChange({ [key]: value })}
      value={stringArray(details[key])}
      wide
    />
  );
  const references = (
    key: string,
    label: string,
    predicate: (entry: StoryBibleEditorEntry) => boolean
  ) => (
    <MultiReferenceField
      ariaLabel={label}
      key={key}
      label={label}
      onChange={(value) => onChange({ [key]: value })}
      options={entryOptions(editor, predicate)}
      value={stringArray(details[key])}
    />
  );

  switch (editor.draft.assetType) {
    case "world.location":
      return (
        <>
          {text("geography", "地理")}
          {text("culture", "文化")}
          <StringOrLinesField
            ariaLabel="地点限制"
            label="限制"
            onChange={(constraints) => onChange({ constraints })}
            value={details["constraints"]}
          />
          <SingleReferenceField
            ariaLabel="所属区域"
            label="所属区域"
            onChange={(regionId) => onChange({ regionId })}
            options={entryOptions(
              editor,
              (entry) => entry.assetType === "world.location" && entry.id !== editor.draft.id
            )}
            value={nullableString(details["regionId"])}
          />
          {references("factionIds", "关联势力", (entry) => entry.assetType === "world.faction")}
        </>
      );
    case "world.faction":
      return (
        <>
          <StringOrLinesField
            ariaLabel="势力目标"
            label="目标"
            onChange={(goals) => onChange({ goals })}
            value={details["goals"]}
          />
          {text("structure", "结构")}
          {text("membersOrInfluence", "成员或影响范围")}
          {references("memberIds", "成员人物", (entry) => entry.kind === "character")}
          {lines("resources", "势力资源")}
          {references(
            "allyIds",
            "盟友势力",
            (entry) => entry.assetType === "world.faction" && entry.id !== editor.draft.id
          )}
          {references(
            "enemyIds",
            "敌对势力",
            (entry) => entry.assetType === "world.faction" && entry.id !== editor.draft.id
          )}
          {references(
            "influenceLocationIds",
            "影响地点",
            (entry) => entry.assetType === "world.location"
          )}
        </>
      );
    case "world.rule":
      return (
        <>
          {text("rule", "规则正文")}
          {text("statement", "规则陈述")}
          {text("scope", "适用范围")}
          {lines("costs", "代价")}
          <StringOrLinesField
            ariaLabel="规则约束"
            label="约束"
            onChange={(constraints) => onChange({ constraints })}
            value={details["constraints"]}
          />
          {lines("limitations", "局限")}
          {lines("exceptions", "例外")}
          <MultiReferenceField
            ariaLabel="已知违规事件"
            label="已知违规事件"
            onChange={(knownViolationEventIds) => onChange({ knownViolationEventIds })}
            options={timelineEventOptions(editor)}
            value={stringArray(details["knownViolationEventIds"])}
          />
        </>
      );
    case "world.glossary":
      return (
        <>
          {text("definition", "定义")}
          {lines("termAliases", "术语别名")}
          {text("firstAppearance", "首次出现说明")}
          <SingleChapterField
            ariaLabel="首次出现章节"
            editor={editor}
            label="首次出现章节"
            onChange={(firstAppearanceChapterId) => onChange({ firstAppearanceChapterId })}
            value={nullableString(details["firstAppearanceChapterId"])}
          />
          {references("relatedRuleIds", "关联规则", (entry) => entry.assetType === "world.rule")}
        </>
      );
    case "world.item":
      return (
        <>
          {text("appearance", "外观")}
          {text("origin", "来源")}
          {lines("abilities", "物品能力")}
          {lines("limitations", "物品限制")}
          <SingleReferenceField
            ariaLabel="物品持有者"
            label="持有者"
            onChange={(holderId) => onChange({ holderId })}
            options={entryOptions(editor, (entry) => entry.id !== editor.draft.id)}
            value={nullableString(details["holderId"])}
          />
          <SingleReferenceField
            ariaLabel="物品当前位置"
            label="当前位置"
            onChange={(currentLocationId) => onChange({ currentLocationId })}
            options={entryOptions(editor, (entry) => entry.assetType === "world.location")}
            value={nullableString(details["currentLocationId"])}
          />
          {text("state", "当前状态")}
          <SingleChapterField
            ariaLabel="物品状态截止章节"
            editor={editor}
            label="状态截止章节"
            onChange={(asOfChapterId) => onChange({ asOfChapterId })}
            value={nullableString(details["asOfChapterId"])}
          />
          <SingleEventField
            ariaLabel="物品状态截止事件"
            editor={editor}
            label="状态截止事件"
            onChange={(asOfEventId) => onChange({ asOfEventId })}
            value={nullableString(details["asOfEventId"])}
          />
          <StateHistoryEditor
            ariaLabel="物品状态历史"
            editor={editor}
            items={recordArray(details["stateHistory"])}
            onChange={(stateHistory) => onChange({ stateHistory })}
          />
        </>
      );
    case "world.lore":
      return (
        <>
          {text("body", "背景说明")}
          {lines("periods", "历史时期")}
          {lines("institutions", "制度机构")}
          {lines("customs", "风俗")}
          {lines("legends", "传说")}
          {lines("systems", "社会系统")}
          {references("relatedRuleIds", "关联规则", (entry) => entry.assetType === "world.rule")}
          {references(
            "relatedGlossaryIds",
            "关联术语",
            (entry) => entry.assetType === "world.glossary"
          )}
        </>
      );
  }
}

function TextInput({
  ariaLabel,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label className="ns-story-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="ns-search-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function TextArea({
  ariaLabel,
  label,
  onChange,
  value,
  wide = false
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
  readonly wide?: boolean;
}) {
  return (
    <label className={`ns-story-field${wide ? " ns-story-field-wide" : ""}`}>
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        className="ns-story-textarea ns-story-textarea-compact"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function LinesField({
  ariaLabel,
  label,
  onChange,
  value,
  wide = false
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string[]) => void;
  readonly value: readonly string[];
  readonly wide?: boolean;
}) {
  return (
    <TextArea
      ariaLabel={ariaLabel}
      label={label}
      onChange={(text) => onChange(splitLines(text))}
      value={value.join("\n")}
      wide={wide}
    />
  );
}

function StringOrLinesField({
  ariaLabel,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string | string[]) => void;
  readonly value: unknown;
}) {
  const mode: VariantMode = Array.isArray(value) ? "lines" : "text";
  return (
    <FieldSection ariaLabel={`${ariaLabel}设定`} title={label}>
      <VariantModeField
        ariaLabel={`${ariaLabel}记录方式`}
        modes={[
          ["text", "描述"],
          ["lines", "列表"]
        ]}
        onChange={(nextMode) => {
          if (nextMode === mode) return;
          onChange(
            nextMode === "lines" ? splitLines(stringValue(value)) : stringArray(value).join("；")
          );
        }}
        value={mode}
      />
      {mode === "lines" ? (
        <LinesField
          ariaLabel={ariaLabel}
          label={`${label}（每行一项）`}
          onChange={onChange}
          value={stringArray(value)}
          wide
        />
      ) : (
        <TextArea
          ariaLabel={ariaLabel}
          label={label}
          onChange={onChange}
          value={stringValue(value)}
          wide
        />
      )}
    </FieldSection>
  );
}

function FieldSection({
  ariaLabel,
  children,
  title
}: {
  readonly ariaLabel: string;
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section aria-label={ariaLabel} className="ns-story-field ns-story-field-wide">
      <strong>{title}</strong>
      <div className="ns-story-form-grid ns-story-form-grid-compact">{children}</div>
    </section>
  );
}

function VariantModeField({
  ariaLabel,
  modes,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly modes: ReadonlyArray<readonly [VariantMode, string]>;
  readonly onChange: (value: VariantMode) => void;
  readonly value: VariantMode;
}) {
  return (
    <label className="ns-story-field">
      <span>记录方式</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.value as VariantMode)}
        value={value}
      >
        {modes.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectField<T extends string>({
  ariaLabel,
  label,
  onChange,
  options,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: T) => void;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly value: T;
}) {
  return (
    <label className="ns-story-field">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.value as T)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function SingleReferenceField({
  ariaLabel,
  label,
  onChange,
  options,
  required = false,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string | null) => void;
  readonly options: readonly StoryBibleReferenceOption[];
  readonly required?: boolean;
  readonly value: string | null;
}) {
  return (
    <StoryBibleReferenceSelector
      ariaLabel={ariaLabel}
      label={label}
      mode="single"
      onChange={onChange}
      options={options}
      required={required}
      value={value}
    />
  );
}

function MultiReferenceField({
  ariaLabel,
  label,
  onChange,
  options,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string[]) => void;
  readonly options: readonly StoryBibleReferenceOption[];
  readonly value: readonly string[];
}) {
  return (
    <StoryBibleReferenceSelector
      ariaLabel={ariaLabel}
      label={label}
      mode="multiple"
      onChange={onChange}
      options={options}
      value={value}
      wide
    />
  );
}

function SingleChapterField({
  ariaLabel,
  editor,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly editor: StoryBibleEditorProps;
  readonly label: string;
  readonly onChange: (value: string | null) => void;
  readonly value: string | null;
}) {
  const options = editor.chapterOptions.map((chapter) => ({
    id: chapter.id,
    title: `${chapter.order}. ${chapter.title}`,
    type: "chapter",
    status: chapter.status,
    state: "ready" as const
  }));
  return (
    <SingleReferenceField
      ariaLabel={ariaLabel}
      label={label}
      onChange={onChange}
      options={options}
      value={value}
    />
  );
}

function SingleEventField({
  ariaLabel,
  editor,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly editor: StoryBibleEditorProps;
  readonly label: string;
  readonly onChange: (value: string | null) => void;
  readonly value: string | null;
}) {
  return (
    <SingleReferenceField
      ariaLabel={ariaLabel}
      label={label}
      onChange={onChange}
      options={timelineEventOptions(editor)}
      value={value}
    />
  );
}

function RecordCard({
  children,
  id,
  index,
  label,
  onRemove,
  revision
}: {
  readonly children: React.ReactNode;
  readonly id?: string;
  readonly index: number;
  readonly label: string;
  readonly onRemove: () => void;
  readonly revision?: number;
}) {
  return (
    <section aria-label={`${label} ${index + 1}`} className="ns-story-field ns-story-field-wide">
      <div>
        <strong>
          {label} {index + 1}
        </strong>
        {id === undefined ? <small>保存后分配稳定 ID</small> : <small>稳定 ID：{id}</small>}
        {revision === undefined ? null : <small> · 修订 {revision}</small>}
        <button
          aria-label={`删除${label} ${index + 1}`}
          className="ns-icon-text-button"
          onClick={onRemove}
          type="button"
        >
          删除
        </button>
      </div>
      <div className="ns-story-form-grid ns-story-form-grid-compact">{children}</div>
    </section>
  );
}

function AddRecordButton({
  ariaLabel,
  disabled = false,
  label,
  onClick
}: {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="ns-icon-text-button"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function StatusField({ editor }: { readonly editor: StoryBibleEditorProps }) {
  return (
    <label className="ns-story-field">
      <span>资料状态</span>
      <select
        aria-label="资料状态"
        disabled={editor.draft.status === "deleted"}
        onChange={(event) =>
          editor.onDraftChange(editor.draft.kind, {
            status: event.currentTarget.value as StoryBibleEditorProps["draft"]["status"]
          })
        }
        value={editor.draft.status}
      >
        <option value="active">启用</option>
        <option value="draft">草稿</option>
        <option value="archived">归档</option>
        {editor.draft.status === "deleted" ? <option value="deleted">已删除</option> : null}
      </select>
    </label>
  );
}

function AliasesField({ editor }: { readonly editor: StoryBibleEditorProps }) {
  return (
    <LinesField
      ariaLabel="资料别名"
      label="别名（每行一个）"
      onChange={(aliases) => editor.onDraftChange(editor.draft.kind, { aliases })}
      value={editor.draft.aliases}
      wide
    />
  );
}

function entryOptions(
  editor: StoryBibleEditorProps,
  predicate: (entry: StoryBibleEditorEntry) => boolean
): StoryBibleReferenceOption[] {
  return storyBibleEntryReferenceOptions(
    editor.entries,
    predicate,
    editor.dirty ? undefined : editor.onEntrySelect
  );
}

function timelineEventOptions(editor: StoryBibleEditorProps): StoryBibleReferenceOption[] {
  return editor.entries.flatMap((entry) =>
    entry.kind !== "timeline"
      ? []
      : entry.timelineEvents.map((event) => ({
          id: event.id,
          title: event.title || event.id,
          type: "timeline.event",
          status: event.status,
          state: entry.status === "deleted" ? "deleted" : "ready",
          selectable: entry.status !== "deleted",
          openEntryId: entry.id,
          ...(editor.dirty ? {} : { onOpen: () => editor.onEntrySelect(entry.id) })
        }))
  );
}

function replaceRecord(
  items: readonly JsonObject[],
  index: number,
  patch: JsonObject
): JsonObject[] {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

function removeRecord(items: readonly JsonObject[], index: number): JsonObject[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function recordKey(item: JsonObject, idField: string, index: number): string {
  return optionalString(item[idField]) ?? `new:${index}`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return optionalString(value) ?? null;
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  return value.replace(/\r\n?/gu, "\n").split("\n");
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

function optionalProp<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
