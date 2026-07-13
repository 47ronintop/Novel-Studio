import {
  CheckCircle2,
  Circle,
  HelpCircle,
  LoaderCircle,
  XCircle
} from "lucide-react";

import type { AgentRunEvent } from "@novel-studio/application";

export function AgentRunTimeline({ events }: { readonly events: readonly AgentRunEvent[] }) {
  const items = timelineItems(events);
  const current = items.at(-1);

  return (
    <section className="ns-agent-timeline" aria-label="Agent 运行时间线">
      <span className="ns-visually-hidden" aria-live="polite">
        {current?.label ?? ""}
      </span>
      <ol>
        {items.map((item) => {
          const expanded = item.status === "running" || item.status === "waiting" || item.status === "failed";
          return (
            <li data-status={item.status} key={item.key}>
              <TimelineIcon status={item.status} />
              <details open={expanded}>
                <summary>
                  <span>{item.label}</span>
                  <small>{item.statusLabel}</small>
                </summary>
                {item.detail === undefined ? null : <p>{item.detail}</p>}
                {item.children === undefined ? null : (
                  <ul className="ns-agent-timeline-group">
                    {item.children.map((child) => (
                      <li key={child.key}>
                        <span>{child.label}</span>
                        <small>{child.statusLabel}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface TimelineItem {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "waiting";
  readonly statusLabel: string;
  readonly category?: "read";
  readonly children?: readonly TimelineItem[];
}

function timelineItems(events: readonly AgentRunEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const startedByCall = new Map<string, number>();
  for (const event of events) {
    if (event.type === "tool_started") {
      const toolCallId = stringDetail(event, "toolCallId") ?? `tool-${event.sequence}`;
      const item: TimelineItem = {
        key: `${event.runId}:${event.sequence}`,
        label:
          stringDetail(event, "summary") ?? toolActivityLabel(stringDetail(event, "toolName")),
        ...optionalDetail(stringDetail(event, "relativePath")),
        status: "running",
        statusLabel: "进行中",
        ...readCategory(stringDetail(event, "toolName"))
      };
      startedByCall.set(toolCallId, items.length);
      items.push(item);
      continue;
    }
    if (event.type === "tool_completed" || event.type === "tool_failed") {
      const toolCallId = stringDetail(event, "toolCallId");
      const itemIndex = toolCallId === undefined ? undefined : startedByCall.get(toolCallId);
      const replacement: TimelineItem = {
        key: itemIndex === undefined ? `${event.runId}:${event.sequence}` : items[itemIndex]?.key ?? "",
        label:
          stringDetail(event, "summary") ?? toolActivityLabel(stringDetail(event, "toolName")),
        ...optionalDetail(
          event.type === "tool_failed"
            ? stringDetail(event, "message")
            : stringDetail(event, "relativePath")
        ),
        status: event.type === "tool_failed" ? "failed" : "completed",
        statusLabel: event.type === "tool_failed" ? "失败" : "已完成",
        ...(itemIndex === undefined
          ? readCategory(stringDetail(event, "toolName"))
          : items[itemIndex]?.category === "read"
            ? { category: "read" as const }
            : {})
      };
      if (itemIndex === undefined) items.push(replacement);
      else items[itemIndex] = replacement;
      continue;
    }
    if (event.type === "user_input_requested") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: stringDetail(event, "prompt") ?? "等待你的决定",
        ...optionalDetail(stringDetail(event, "reason")),
        status: "waiting",
        statusLabel: "待回答"
      });
    } else if (event.type === "context_stale") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: "上下文已变化",
        status: "waiting",
        statusLabel: "待刷新"
      });
    } else if (event.type === "plan_ready") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: "计划已就绪",
        status: "waiting",
        statusLabel: "待审阅"
      });
    }
  }
  return aggregateCompletedReads(items);
}

function aggregateCompletedReads(items: readonly TimelineItem[]): TimelineItem[] {
  const aggregated: TimelineItem[] = [];
  for (let index = 0; index < items.length; ) {
    const consecutive: TimelineItem[] = [];
    while (
      index < items.length &&
      items[index]?.category === "read" &&
      items[index]?.status === "completed"
    ) {
      const item = items[index];
      if (item !== undefined) consecutive.push(item);
      index += 1;
    }
    if (consecutive.length === 0) {
      const item = items[index];
      if (item !== undefined) aggregated.push(item);
      index += 1;
    } else if (consecutive.length > 3) {
      const first = consecutive[0];
      if (first !== undefined) {
        aggregated.push({
          key: `${first.key}:read-group`,
          label: `已读取 ${consecutive.length} 项`,
          status: "completed",
          statusLabel: "已完成",
          category: "read",
          children: consecutive
        });
      }
    } else {
      aggregated.push(...consecutive);
    }
  }
  return aggregated;
}

function TimelineIcon({ status }: { readonly status: TimelineItem["status"] }) {
  const props = { "aria-hidden": true as const, size: 15 };
  if (status === "running") return <LoaderCircle {...props} className="ns-agent-spin" />;
  if (status === "completed") return <CheckCircle2 {...props} />;
  if (status === "failed") return <XCircle {...props} />;
  if (status === "waiting") return <HelpCircle {...props} />;
  return <Circle {...props} />;
}

function toolActivityLabel(toolName: string | undefined): string {
  switch (toolName) {
    case "list_project_entries":
      return "正在读取项目结构";
    case "read_chapter":
      return "正在读取第 3 章";
    case "read_story_bible":
      return "正在读取 Story Bible";
    case "read_project_text":
      return "正在读取项目文本";
    default:
      return "正在处理只读步骤";
  }
}

function stringDetail(event: AgentRunEvent, key: string): string | undefined {
  const value = event.detail?.[key];
  return typeof value === "string" ? value : undefined;
}

function optionalDetail(value: string | undefined): { readonly detail: string } | object {
  return value === undefined ? {} : { detail: value };
}

function readCategory(toolName: string | undefined): { readonly category: "read" } | object {
  return toolName === "list_project_entries" || toolName?.startsWith("read_") === true
    ? { category: "read" }
    : {};
}
