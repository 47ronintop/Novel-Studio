import { CheckCircle2 } from "lucide-react";

import type { AgentRunEvent } from "@novel-studio/application";

import { AgentRunTimeline } from "./agent-run-timeline.js";

export function AgentActivitySummary({
  events
}: {
  readonly events: readonly AgentRunEvent[];
}) {
  const orderedEvents = [...events].sort(compareEvents);
  const completedEvents = orderedEvents.filter((event) => event.type === "tool_completed");
  const currentEvent = currentToolEvent(orderedEvents);

  if (completedEvents.length === 0 && currentEvent === undefined) return null;

  return (
    <section className="ns-agent-activity" aria-label="Agent 运行时间线">
      {completedEvents.length === 0 ? null : (
        <details className="ns-agent-activity-summary" aria-label="Agent 活动摘要">
          <summary>
            <CheckCircle2 aria-hidden="true" size={15} />
            <span>{activitySummary(completedEvents, orderedEvents)}</span>
          </summary>
          <AgentRunTimeline ariaLabel="Agent 已完成活动" events={completedEvents} />
        </details>
      )}
      {currentEvent === undefined ? null : (
        <section className="ns-agent-current-activity" aria-label="Agent 当前活动">
          <AgentRunTimeline ariaLabel="Agent 当前活动时间线" events={[currentEvent]} />
        </section>
      )}
    </section>
  );
}

function currentToolEvent(events: readonly AgentRunEvent[]): AgentRunEvent | undefined {
  const latestToolEvent = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "tool_started" ||
        event.type === "tool_completed" ||
        event.type === "tool_failed"
    );
  return latestToolEvent?.type === "tool_started" || latestToolEvent?.type === "tool_failed"
    ? latestToolEvent
    : undefined;
}

function activitySummary(
  completedEvents: readonly AgentRunEvent[],
  allEvents: readonly AgentRunEvent[]
): string {
  const readCount = completedEvents.filter((event) =>
    isReadTool(stringDetail(event, "toolName"))
  ).length;
  const proposedEvents = completedEvents.filter((event) =>
    isProposalTool(stringDetail(event, "toolName"))
  );
  const changedPaths = new Set(
    proposedEvents.flatMap((event) => {
      const relativePath = stringDetail(event, "relativePath");
      return relativePath === undefined ? [] : [relativePath];
    })
  );
  for (const event of allEvents) {
    if (event.type !== "change_set_ready") continue;
    for (const path of changeSetPaths(event)) changedPaths.add(path);
  }
  const writeCount = changedPaths.size > 0 ? changedPaths.size : proposedEvents.length;
  const otherCount = completedEvents.length - readCount - proposedEvents.length;
  const parts: string[] = [];
  if (readCount > 0) parts.push(`已读取 ${readCount} 项`);
  if (writeCount > 0) parts.push(`修改 ${writeCount} 个文件`);
  if (otherCount > 0) parts.push(`完成 ${otherCount} 项`);
  return parts.length > 0 ? parts.join(" · ") : `已完成 ${completedEvents.length} 项`;
}

function changeSetPaths(event: AgentRunEvent): readonly string[] {
  const changeSet = event.detail?.["changeSet"];
  if (!isRecord(changeSet) || !Array.isArray(changeSet["files"])) return [];
  return changeSet["files"].flatMap((file) => {
    if (!isRecord(file)) return [];
    const relativePath = file["relativePath"];
    return typeof relativePath === "string" ? [relativePath] : [];
  });
}

function isReadTool(toolName: string | undefined): boolean {
  return toolName === "list_project_entries" || toolName?.startsWith("read_") === true;
}

function isProposalTool(toolName: string | undefined): boolean {
  return toolName === "propose_chapter_write" || toolName === "propose_file_write";
}

function stringDetail(event: AgentRunEvent, key: string): string | undefined {
  const value = event.detail?.[key];
  return typeof value === "string" ? value : undefined;
}

function compareEvents(left: AgentRunEvent, right: AgentRunEvent): number {
  return left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
