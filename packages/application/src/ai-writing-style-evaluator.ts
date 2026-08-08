import {
  DEFAULT_AI_WRITING_STYLE_RULE_PACK,
  type AiWritingStyleRule,
  type AiWritingStyleRuleId,
  type AiWritingStyleRulePack
} from "./ai-writing-style-rules.js";

/** The frozen detector version. Prompt registration binds this value separately. */
export const AI_WRITING_STYLE_RULE_VERSION = "2.0";

export type AiWritingStyleConfidence = "low" | "medium" | "high";
export type AiWritingStyleChangeKind = "introduced" | "pre_existing";

export interface AiWritingStylePosition {
  /** UTF-16 offset, matching the editor range contract. */
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface AiWritingStyleExcerpt {
  readonly text: string;
  /** UTF-16 offsets in the candidate text. */
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface AiWritingStyleEvaluationHit {
  readonly ruleId: AiWritingStyleRuleId;
  readonly title: string;
  readonly suggestion: string;
  readonly confidence: AiWritingStyleConfidence;
  readonly changeKind: AiWritingStyleChangeKind;
  /** Low-confidence and pre-existing findings are folded by default. */
  readonly defaultCollapsed: boolean;
  /** UTF-16 offsets in the candidate text. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly start: AiWritingStylePosition;
  readonly end: AiWritingStylePosition;
  readonly matchedText: string;
  readonly excerpt: AiWritingStyleExcerpt;
}

export interface AiWritingStyleEvaluation {
  readonly schemaVersion: "1.0";
  readonly ruleVersion: typeof AI_WRITING_STYLE_RULE_VERSION;
  /** Findings are reminders only and never authorize mutation or block an action. */
  readonly enforcement: "advisory";
  readonly status: "clean" | "attention";
  /** Only introduced medium/high findings are counted. */
  readonly hitCount: number;
  readonly hits: readonly AiWritingStyleEvaluationHit[];
}

export interface EvaluateAiWritingStyleOptions {
  readonly baselineText: string;
  readonly candidateText: string;
  readonly rulePack?: AiWritingStyleRulePack;
}

interface CandidateFinding {
  readonly rule: AiWritingStyleRule;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly matchedText: string;
  readonly confidence: AiWritingStyleConfidence;
}

interface TextRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

const GUIDANCE_ONLY_PHRASES = new Set(["冷冷", "压下去"]);
const MECHANICAL_EMOTION_PHRASES = new Set(["呼吸一滞", "指尖发紧", "心口一沉"]);
const CLUSTER_DISTANCE = 96;
const EXCERPT_CONTEXT_GRAPHEMES = 12;
const MAX_DIFF_TRACE_CELLS = 200_000;
const EMOTIONAL_CONTRAST =
  /害怕|恐惧|悲伤|难过|失望|愤怒|愤恨|爱|喜欢|不舍|软弱|勇敢|明白|意识到|选择|命运/u;

/**
 * Evaluates a proposed body against the frozen local rules. The baseline is
 * scanned with the same rule pack as the candidate before diff classification,
 * so callers cannot accidentally compare results produced by different rule
 * versions. A finding is pre-existing only when its candidate span remains
 * outside every changed range; duplicate phrases do not consume one another's
 * baseline count.
 */
export function evaluateAiWritingStyle(
  options: EvaluateAiWritingStyleOptions
): AiWritingStyleEvaluation {
  const rulePack = options.rulePack ?? DEFAULT_AI_WRITING_STYLE_RULE_PACK;
  // Keep the baseline scan on the same frozen rule pack. Equivalent findings
  // are consumed as a multiset: unchanged candidate findings claim their
  // baseline counterpart first, so a newly-added duplicate cannot inherit the
  // old finding's pre-existing status.
  const baselineFindings = scanText(options.baselineText, rulePack);
  const candidateFindings = scanText(options.candidateText, rulePack);
  const changedCandidateRanges = findChangedCandidateRanges(
    options.baselineText,
    options.candidateText
  );
  const sortedCandidateFindings = candidateFindings
    .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)
    .map((finding) => ({
      finding,
      intersectsChangedRange: changedCandidateRanges.some((range) =>
        rangesIntersect(finding, range)
      )
    }));
  const availableBaselineFindings = baselineFindingMultiset(baselineFindings);
  const changeKinds = new Map<CandidateFinding, AiWritingStyleChangeKind>();

  // Claim equivalents for unchanged findings before examining changed spans.
  // An unchanged span is always pre-existing; consuming its baseline
  // counterpart only prevents a later added duplicate from inheriting that
  // identity.
  for (const candidate of sortedCandidateFindings) {
    if (candidate.intersectsChangedRange) continue;
    consumeEquivalentBaselineFinding(availableBaselineFindings, candidate.finding);
    changeKinds.set(candidate.finding, "pre_existing");
  }
  for (const candidate of sortedCandidateFindings) {
    if (!candidate.intersectsChangedRange) continue;
    changeKinds.set(
      candidate.finding,
      consumeEquivalentBaselineFinding(availableBaselineFindings, candidate.finding)
        ? "pre_existing"
        : "introduced"
    );
  }
  const hits = sortedCandidateFindings.map(({ finding }) =>
    toEvaluationHit(options.candidateText, finding, changeKinds.get(finding) ?? "introduced")
  );

  const hitCount = hits.filter(
    (hit) => hit.changeKind === "introduced" && hit.confidence !== "low"
  ).length;
  return {
    schemaVersion: "1.0",
    ruleVersion: AI_WRITING_STYLE_RULE_VERSION,
    enforcement: "advisory",
    status: hitCount === 0 ? "clean" : "attention",
    hitCount,
    hits
  };
}

function scanText(text: string, pack: AiWritingStyleRulePack): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  const quotedRanges = quotedTextRanges(text);
  for (const rule of pack.rules) {
    if (rule.ruleId === "mechanical-emotion") {
      findings.push(...scanMechanicalEmotion(text, rule));
      continue;
    }
    if (rule.structuralPattern === "stacked-simile") {
      findings.push(...scanStackedSimile(text, rule));
      continue;
    }
    if (rule.structuralPattern === "explanatory-contrast") {
      findings.push(...scanExplanatoryContrast(text, rule));
      continue;
    }
    for (const phrase of rule.phrases ?? []) {
      for (const startOffset of findPhraseOffsets(text, phrase)) {
        const endOffset = startOffset + phrase.length;
        // Generic phrase rules must not diagnose quoted prose or dialogue.
        // Structural rules retain their existing sentence-level quote handling.
        if (isWithinQuotedRange(startOffset, endOffset, quotedRanges)) continue;
        findings.push({
          rule,
          startOffset,
          endOffset,
          matchedText: phrase,
          confidence: "medium"
        });
      }
    }
  }
  const uniqueFindings = new Map<string, CandidateFinding>();
  for (const finding of findings) {
    const key = `${finding.rule.ruleId}\u0000${finding.startOffset}\u0000${finding.endOffset}\u0000${finding.confidence}`;
    if (!uniqueFindings.has(key)) uniqueFindings.set(key, finding);
  }
  return [...uniqueFindings.values()];
}

function scanMechanicalEmotion(text: string, rule: AiWritingStyleRule): CandidateFinding[] {
  const lowFindings: CandidateFinding[] = [];
  const quotedRanges = quotedTextRanges(text);
  for (const phrase of rule.phrases ?? []) {
    if (GUIDANCE_ONLY_PHRASES.has(phrase) || !MECHANICAL_EMOTION_PHRASES.has(phrase)) {
      continue;
    }
    for (const startOffset of findPhraseOffsets(text, phrase)) {
      const endOffset = startOffset + phrase.length;
      if (isWithinQuotedRange(startOffset, endOffset, quotedRanges)) continue;
      lowFindings.push({
        rule,
        startOffset,
        endOffset,
        matchedText: phrase,
        confidence: "low"
      });
    }
  }

  return lowFindings.map((finding) => ({
    ...finding,
    confidence: isRepeatedOrClustered(finding, lowFindings) ? "medium" : "low"
  }));
}

function isRepeatedOrClustered(
  finding: CandidateFinding,
  allFindings: readonly CandidateFinding[]
): boolean {
  return allFindings.some(
    (other) =>
      other !== finding && Math.abs(other.startOffset - finding.startOffset) <= CLUSTER_DISTANCE
  );
}

function scanStackedSimile(text: string, rule: AiWritingStyleRule): CandidateFinding[] {
  return splitSentences(text).flatMap((sentence) => {
    if (containsQuotedText(sentence.text)) {
      return [];
    }
    const similes = [...sentence.text.matchAll(/像(?=[^。！？\n]{0,24})/gu)];
    if (similes.length < 2) {
      return [];
    }
    const first = similes[0];
    const second = similes[1];
    if (first?.index === undefined || second?.index === undefined) {
      return [];
    }
    const startOffset = sentence.startOffset + first.index;
    const secondSimileEndOffset = second.index + "像".length;
    const localEndOffset = endAfterNextNonWhitespaceGrapheme(sentence.text, secondSimileEndOffset);
    const endOffset = sentence.startOffset + localEndOffset;
    return [
      {
        rule,
        startOffset,
        endOffset,
        matchedText: text.slice(startOffset, endOffset),
        confidence: "medium" as const
      }
    ];
  });
}

function endAfterNextNonWhitespaceGrapheme(text: string, startOffset: number): number {
  for (const range of graphemeRanges(text)) {
    if (range.startOffset < startOffset) continue;
    if (/\S/u.test(text.slice(range.startOffset, range.endOffset))) {
      return range.endOffset;
    }
  }
  return startOffset;
}

function scanExplanatoryContrast(text: string, rule: AiWritingStyleRule): CandidateFinding[] {
  return splitSentences(text).flatMap((sentence) => {
    if (containsQuotedText(sentence.text)) {
      return [];
    }
    const match = /不是([^。！？\n]{0,32})是/gu.exec(sentence.text);
    if (match === null || match.index === undefined || !EMOTIONAL_CONTRAST.test(sentence.text)) {
      return [];
    }
    const startOffset = sentence.startOffset + match.index;
    const endOffset = startOffset + match[0].length;
    return [
      {
        rule,
        startOffset,
        endOffset,
        matchedText: match[0],
        confidence: "medium" as const
      }
    ];
  });
}

function splitSentences(
  text: string
): Array<{ readonly text: string; readonly startOffset: number }> {
  const sentences: Array<{ readonly text: string; readonly startOffset: number }> = [];
  let startOffset = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/[。！？\n]/u.test(text[index] ?? "")) {
      if (index > startOffset) {
        sentences.push({ text: text.slice(startOffset, index), startOffset });
      }
      startOffset = index + 1;
    }
  }
  if (startOffset < text.length) {
    sentences.push({ text: text.slice(startOffset), startOffset });
  }
  return sentences;
}

function containsQuotedText(text: string): boolean {
  return /[“”"'‘’「」『』]/u.test(text);
}

function findPhraseOffsets(text: string, phrase: string): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const startOffset = text.indexOf(phrase, cursor);
    if (startOffset === -1) {
      break;
    }
    offsets.push(startOffset);
    cursor = startOffset + Math.max(phrase.length, 1);
  }
  return offsets;
}

function baselineFindingMultiset(
  findings: readonly CandidateFinding[]
): Map<string, CandidateFinding[]> {
  const multiset = new Map<string, CandidateFinding[]>();
  for (const finding of findings) {
    const key = equivalentFindingKey(finding);
    const entries = multiset.get(key);
    if (entries === undefined) {
      multiset.set(key, [finding]);
    } else {
      entries.push(finding);
    }
  }
  return multiset;
}

function consumeEquivalentBaselineFinding(
  multiset: Map<string, CandidateFinding[]>,
  finding: CandidateFinding
): boolean {
  const key = equivalentFindingKey(finding);
  const entries = multiset.get(key);
  if (entries === undefined || entries.length === 0) return false;
  entries.pop();
  return true;
}

function equivalentFindingKey(finding: CandidateFinding): string {
  return `${finding.rule.ruleId}\u0000${finding.matchedText}\u0000${finding.confidence}`;
}

function quotedTextRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const openToClose: Readonly<Record<string, string>> = {
    "“": "”",
    "‘": "’",
    "「": "」",
    "『": "』"
  };
  const stack: Array<{ readonly startOffset: number; readonly close: string }> = [];
  for (let offset = 0; offset < text.length; offset += 1) {
    const character = text[offset] ?? "";
    const expectedClose = stack.at(-1)?.close;
    if (expectedClose === character) {
      const opened = stack.pop();
      if (opened !== undefined)
        ranges.push({ startOffset: opened.startOffset, endOffset: offset + 1 });
      continue;
    }
    const close = openToClose[character];
    if (close !== undefined) {
      stack.push({ startOffset: offset, close });
      continue;
    }
    if (character === '"' || character === "'") {
      if (expectedClose === character) {
        const opened = stack.pop();
        if (opened !== undefined)
          ranges.push({ startOffset: opened.startOffset, endOffset: offset + 1 });
      } else {
        stack.push({ startOffset: offset, close: character });
      }
    }
  }
  for (const opened of stack) {
    ranges.push({ startOffset: opened.startOffset, endOffset: text.length });
  }
  return ranges;
}

function isWithinQuotedRange(
  startOffset: number,
  endOffset: number,
  ranges: readonly TextRange[]
): boolean {
  return ranges.some((range) => startOffset >= range.startOffset && endOffset <= range.endOffset);
}

function findChangedCandidateRanges(baseline: string, candidate: string): TextRange[] {
  if (baseline === candidate) {
    return [];
  }
  const prefixLength = commonPrefixLength(baseline, candidate);
  const suffixLength = commonSuffixLength(baseline, candidate, prefixLength);
  const baselineMiddle = baseline.slice(prefixLength, baseline.length - suffixLength);
  const candidateMiddle = candidate.slice(prefixLength, candidate.length - suffixLength);
  const operations = diffCodeUnits(baselineMiddle, candidateMiddle);
  if (operations === undefined) {
    // Diff is advisory.  When a very large replacement exceeds the bounded
    // trace budget, conservatively mark only the changed middle as introduced
    // instead of blocking the review or allocating unbounded memory.
    return [
      {
        startOffset: prefixLength,
        endOffset: candidate.length - suffixLength
      }
    ];
  }
  const ranges: TextRange[] = [];
  let candidateOffset = prefixLength;
  let changedStart: number | undefined;
  for (const operation of operations) {
    if (operation === "equal") {
      if (changedStart !== undefined) {
        ranges.push({ startOffset: changedStart, endOffset: candidateOffset });
        changedStart = undefined;
      }
      candidateOffset += 1;
      continue;
    }
    changedStart ??= candidateOffset;
    if (operation === "insert") candidateOffset += 1;
  }
  if (changedStart !== undefined) {
    ranges.push({ startOffset: changedStart, endOffset: candidateOffset });
  }
  return ranges;
}

function commonPrefixLength(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  let offset = 0;
  while (offset < sharedLength && left[offset] === right[offset]) offset += 1;
  return offset;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  let leftOffset = left.length;
  let rightOffset = right.length;
  let length = 0;
  while (
    leftOffset > prefixLength &&
    rightOffset > prefixLength &&
    left[leftOffset - 1] === right[rightOffset - 1]
  ) {
    leftOffset -= 1;
    rightOffset -= 1;
    length += 1;
  }
  return length;
}

/**
 * Myers' shortest-edit diff over UTF-16 code units.  The evaluator's public
 * offsets are UTF-16, so using the same unit here keeps changed ranges aligned
 * with findings while still allowing multiple independent edits to remain
 * separate.  The trace is bounded by the actual edit distance rather than the
 * full text size for the normal, small-edit workflow.
 */
function diffCodeUnits(
  baseline: string,
  candidate: string
): Array<"equal" | "insert" | "delete"> | undefined {
  const baselineLength = baseline.length;
  const candidateLength = candidate.length;
  const maxDistance = baselineLength + candidateLength;
  const trace: Array<Map<number, number>> = [];
  const frontier = new Map<number, number>([[1, 0]]);
  let distance = 0;

  for (; distance <= maxDistance; distance += 1) {
    const traceCells = ((distance + 1) * (distance + 2)) / 2;
    if (traceCells > MAX_DIFF_TRACE_CELLS) return undefined;
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -1;
      const right = (frontier.get(diagonal - 1) ?? -1) + 1;
      let baselineOffset =
        diagonal === -distance || (diagonal !== distance && down > right) ? down : right;
      let candidateOffset = baselineOffset - diagonal;
      while (
        baselineOffset < baselineLength &&
        candidateOffset < candidateLength &&
        baseline[baselineOffset] === candidate[candidateOffset]
      ) {
        baselineOffset += 1;
        candidateOffset += 1;
      }
      frontier.set(diagonal, baselineOffset);
      if (baselineOffset >= baselineLength && candidateOffset >= candidateLength) {
        return backtrackDiff(trace, distance, baselineOffset, candidateOffset);
      }
    }
  }
  return undefined;
}

function backtrackDiff(
  trace: readonly Map<number, number>[],
  distance: number,
  baselineOffset: number,
  candidateOffset: number
): Array<"equal" | "insert" | "delete"> {
  const operations: Array<"equal" | "insert" | "delete"> = [];
  let currentBaseline = baselineOffset;
  let currentCandidate = candidateOffset;
  for (let currentDistance = distance; currentDistance > 0; currentDistance -= 1) {
    const frontier = trace[currentDistance];
    const diagonal = currentBaseline - currentCandidate;
    const down = frontier?.get(diagonal + 1) ?? -1;
    const right = (frontier?.get(diagonal - 1) ?? -1) + 1;
    const previousDiagonal =
      diagonal === -currentDistance || (diagonal !== currentDistance && down > right)
        ? diagonal + 1
        : diagonal - 1;
    const previousBaseline = frontier?.get(previousDiagonal) ?? 0;
    const previousCandidate = previousBaseline - previousDiagonal;
    while (currentBaseline > previousBaseline && currentCandidate > previousCandidate) {
      operations.push("equal");
      currentBaseline -= 1;
      currentCandidate -= 1;
    }
    if (currentBaseline === previousBaseline) {
      operations.push("insert");
      currentCandidate -= 1;
    } else {
      operations.push("delete");
      currentBaseline -= 1;
    }
  }
  while (currentBaseline > 0 && currentCandidate > 0) {
    operations.push("equal");
    currentBaseline -= 1;
    currentCandidate -= 1;
  }
  while (currentBaseline > 0) {
    operations.push("delete");
    currentBaseline -= 1;
  }
  while (currentCandidate > 0) {
    operations.push("insert");
    currentCandidate -= 1;
  }
  return operations.reverse();
}

function rangesIntersect(finding: CandidateFinding, range: TextRange): boolean {
  if (range.startOffset === range.endOffset) {
    // A deletion has no candidate bytes of its own.  It only introduces a
    // finding when it removes code units from the middle of that finding;
    // deleting immediately before/after an otherwise unchanged span keeps it
    // pre-existing.
    return finding.startOffset < range.startOffset && finding.endOffset > range.endOffset;
  }
  return finding.startOffset < range.endOffset && finding.endOffset > range.startOffset;
}

function toEvaluationHit(
  text: string,
  finding: CandidateFinding,
  changeKind: AiWritingStyleChangeKind
): AiWritingStyleEvaluationHit {
  return {
    ruleId: finding.rule.ruleId,
    title: finding.rule.title,
    suggestion: finding.rule.suggestion,
    confidence: finding.confidence,
    changeKind,
    defaultCollapsed: finding.confidence === "low" || changeKind === "pre_existing",
    startOffset: finding.startOffset,
    endOffset: finding.endOffset,
    start: positionAt(text, finding.startOffset),
    end: positionAt(text, finding.endOffset),
    matchedText: finding.matchedText,
    excerpt: excerptAround(text, finding.startOffset, finding.endOffset)
  };
}

function positionAt(text: string, offset: number): AiWritingStylePosition {
  let line = 1;
  let lineStartOffset = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStartOffset = index + 1;
    }
  }
  return { offset, line, column: offset - lineStartOffset + 1 };
}

function excerptAround(
  text: string,
  startOffset: number,
  endOffset: number
): AiWritingStyleExcerpt {
  const graphemes = graphemeRanges(text);
  const startIndex = graphemes.findIndex((range) => range.endOffset > startOffset);
  let endIndex = -1;
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index];
    if (grapheme !== undefined && grapheme.startOffset < endOffset) {
      endIndex = index;
      break;
    }
  }
  const safeStartIndex =
    startIndex === -1 ? 0 : Math.max(0, startIndex - EXCERPT_CONTEXT_GRAPHEMES);
  const safeEndIndex =
    endIndex === -1
      ? graphemes.length - 1
      : Math.min(graphemes.length - 1, endIndex + EXCERPT_CONTEXT_GRAPHEMES);
  const start = graphemes[safeStartIndex];
  const end = graphemes[safeEndIndex];
  if (start === undefined || end === undefined) {
    return { text: "", startOffset: 0, endOffset: 0 };
  }
  return {
    text: text.slice(start.startOffset, end.endOffset),
    startOffset: start.startOffset,
    endOffset: end.endOffset
  };
}

function graphemeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let clusterStart = 0;
  let previousWasJoiner = false;
  let index = 0;
  for (const codePoint of text) {
    const nextIndex = index + codePoint.length;
    const joinsPrevious =
      index > 0 &&
      (codePoint === "\u200d" ||
        previousWasJoiner ||
        isCombiningMark(codePoint) ||
        isVariationSelector(codePoint) ||
        isEmojiModifier(codePoint));
    if (!joinsPrevious) {
      if (index > clusterStart) {
        ranges.push({ startOffset: clusterStart, endOffset: index });
      }
      clusterStart = index;
    }
    previousWasJoiner = codePoint === "\u200d";
    index = nextIndex;
  }
  if (clusterStart < text.length) {
    ranges.push({ startOffset: clusterStart, endOffset: text.length });
  }
  return ranges;
}

function isCombiningMark(value: string): boolean {
  return /\p{Mark}/u.test(value);
}

function isVariationSelector(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function isEmojiModifier(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}
