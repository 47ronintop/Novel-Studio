export type AiWritingStyleRuleId =
  "stacked-simile" | "explanatory-contrast" | "mechanical-emotion" | "direct-realization";

export type AiWritingStyleRuleSeverity = "notice" | "warning";

export interface AiWritingStyleRule {
  readonly ruleId: AiWritingStyleRuleId;
  readonly title: string;
  readonly description: string;
  readonly promptInstruction: string;
  readonly severity: AiWritingStyleRuleSeverity;
  readonly suggestion: string;
  readonly phrases?: readonly string[];
  readonly structuralPattern?: "stacked-simile" | "explanatory-contrast";
}

export interface AiWritingStyleRulePack {
  readonly packId: string;
  readonly language: "zh-CN";
  readonly title: string;
  readonly rules: readonly AiWritingStyleRule[];
}

export interface AiWritingStyleHit {
  readonly ruleId: AiWritingStyleRuleId;
  readonly title: string;
  readonly severity: AiWritingStyleRuleSeverity;
  readonly matchedText: string;
  readonly positionLabel: string;
  readonly suggestion: string;
}

export interface AiWritingStyleReview {
  readonly status: "clean" | "attention";
  readonly hitCount: number;
  readonly hits: readonly AiWritingStyleHit[];
}

export const DEFAULT_AI_WRITING_STYLE_RULE_PACK: AiWritingStyleRulePack = {
  packId: "default-zh-writing-quality",
  language: "zh-CN",
  title: "中文小说文风规则",
  rules: [
    {
      ruleId: "stacked-simile",
      title: "连续比喻",
      description: "同一句里连续套用多个像、仿佛、如同结构时，容易削弱画面焦点。",
      promptInstruction:
        "避免同一句连续套用两个“像...”式比喻；保留最准确的一个，其余改成动作、感官或具体细节。",
      severity: "notice",
      suggestion: "保留一个更准确的比喻，另一个改成动作或感官细节。",
      structuralPattern: "stacked-simile"
    },
    {
      ruleId: "explanatory-contrast",
      title: "解释性对照",
      description: "“不是...是...”容易把心理或主题直接讲出来。",
      promptInstruction: "减少“不是...是...”式解释，把转折放进人物选择、对白、动作或场景反应。",
      severity: "notice",
      suggestion: "把解释性判断拆成动作、对白或具体选择。",
      structuralPattern: "explanatory-contrast"
    },
    {
      ruleId: "mechanical-emotion",
      title: "模板化情绪词",
      description: "高频情绪短语会让人物反应显得套版。",
      promptInstruction:
        "遇到“冷冷”“压下去”“呼吸一滞”“指尖发紧”“心口一沉”等表达时，优先改成可观察的动作、语气或环境反应。",
      severity: "notice",
      suggestion: "改成可观察的动作、语气或环境反应。",
      phrases: ["冷冷", "压下去", "呼吸一滞", "指尖发紧", "心口一沉"]
    },
    {
      ruleId: "direct-realization",
      title: "直白顿悟句",
      description: "直接写“终于明白”“终于意识到”会压缩人物变化过程。",
      promptInstruction:
        "减少“终于明白”“终于意识到”“知道自己必须”等直白顿悟句，用前后行为变化承载人物决定。",
      severity: "notice",
      suggestion: "用前后行为变化承载人物决定。",
      phrases: ["终于明白", "终于意识到", "知道自己必须"]
    }
  ]
};

export function formatAiWritingStyleRulesForPrompt(
  pack: AiWritingStyleRulePack = DEFAULT_AI_WRITING_STYLE_RULE_PACK
): string {
  return [
    `文风规则：${pack.title}。生成前请按以下规则自检，目标是让章节更具体、自然、符合当前叙事声音。`,
    ...pack.rules.map((rule, index) => `${index + 1}. ${rule.title}：${rule.promptInstruction}`),
    "输出仍只返回请求要求的 JSON 字段，不要额外附加规则说明。"
  ].join("\n");
}

export function reviewAiWritingStyle(
  text: string,
  pack: AiWritingStyleRulePack = DEFAULT_AI_WRITING_STYLE_RULE_PACK
): AiWritingStyleReview {
  const hits = pack.rules
    .flatMap((rule) => findRuleHits(text, rule))
    .sort(
      (left, right) =>
        positionFromLabel(left.positionLabel) - positionFromLabel(right.positionLabel)
    );

  return {
    status: hits.length === 0 ? "clean" : "attention",
    hitCount: hits.length,
    hits
  };
}

function findRuleHits(text: string, rule: AiWritingStyleRule): AiWritingStyleHit[] {
  const hits: AiWritingStyleHit[] = [];
  const seen = new Set<string>();
  for (const phrase of rule.phrases ?? []) {
    for (const index of findPhraseIndexes(text, phrase)) {
      pushHit(hits, seen, rule, phrase, index);
    }
  }

  if (rule.structuralPattern === "stacked-simile") {
    for (const match of findRegexMatches(text, /像[^。！？\n]{0,24}像[^。！？\n]{0,24}/gu)) {
      pushHit(hits, seen, rule, match.value, match.index);
    }
  }

  if (rule.structuralPattern === "explanatory-contrast") {
    for (const match of findRegexMatches(text, /不是[^。！？\n]{0,32}是/gu)) {
      pushHit(hits, seen, rule, match.value, match.index);
    }
  }

  return hits;
}

function pushHit(
  hits: AiWritingStyleHit[],
  seen: Set<string>,
  rule: AiWritingStyleRule,
  matchedText: string,
  index: number
): void {
  const normalized = compactMatchedText(matchedText);
  const key = `${rule.ruleId}:${index}:${normalized}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  hits.push({
    ruleId: rule.ruleId,
    title: rule.title,
    severity: rule.severity,
    matchedText: normalized,
    positionLabel: formatPositionLabel(index),
    suggestion: rule.suggestion
  });
}

function findPhraseIndexes(text: string, phrase: string): number[] {
  const indexes: number[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(phrase, cursor);
    if (index === -1) {
      break;
    }
    indexes.push(index);
    cursor = index + Math.max(phrase.length, 1);
  }
  return indexes;
}

function findRegexMatches(
  text: string,
  pattern: RegExp
): Array<{ readonly value: string; readonly index: number }> {
  const matches: Array<{ readonly value: string; readonly index: number }> = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    matches.push({
      value: match[0],
      index: match.index
    });
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
    match = pattern.exec(text);
  }
  return matches;
}

function compactMatchedText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 36 ? normalized : `${normalized.slice(0, 36)}...`;
}

function formatPositionLabel(index: number): string {
  return `第 ${index + 1} 字附近`;
}

function positionFromLabel(label: string): number {
  const match = /第 (\d+) 字附近/u.exec(label);
  return match === null ? 0 : Number(match[1]);
}
