import { CheckCircle2, Circle, HelpCircle, LoaderCircle, XCircle } from "lucide-react";

import type { AgentRunEvent } from "@novel-studio/application";

export function AgentRunTimeline({
  events,
  ariaLabel = "Agent 运行时间线"
}: {
  readonly events: readonly AgentRunEvent[];
  readonly ariaLabel?: string;
}) {
  const items = timelineItems(events);
  const current = items.at(-1);

  if (items.length === 0) return null;

  return (
    <section className="ns-agent-timeline" aria-label={ariaLabel}>
      <span className="ns-visually-hidden" aria-live="polite">
        {current?.label ?? ""}
      </span>
      <ol>
        {items.map((item) => {
          const expanded =
            item.status === "running" || item.status === "waiting" || item.status === "failed";
          return (
            <li data-status={item.status} key={item.key}>
              <TimelineIcon status={item.status} />
              <details open={expanded}>
                <summary>
                  <span>{item.label}</span>
                  <small>{item.statusLabel}</small>
                </summary>
                {item.detail === undefined ? null : <p>{item.detail}</p>}
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
}

function timelineItems(events: readonly AgentRunEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const startedByCall = new Map<string, number>();
  for (const event of [...events].sort(compareEvents)) {
    if (event.type === "tool_started") {
      const toolCallId = stringDetail(event, "toolCallId") ?? `tool-${event.sequence}`;
      const item: TimelineItem = {
        key: `${event.runId}:${event.sequence}`,
        label: stringDetail(event, "summary") ?? toolActivityLabel(stringDetail(event, "toolName")),
        ...optionalDetail(stringDetail(event, "relativePath")),
        status: "running",
        statusLabel: "进行中"
      };
      startedByCall.set(toolCallId, items.length);
      items.push(item);
      continue;
    }
    if (event.type === "tool_completed" || event.type === "tool_failed") {
      const toolCallId = stringDetail(event, "toolCallId");
      const itemIndex = toolCallId === undefined ? undefined : startedByCall.get(toolCallId);
      const replacement: TimelineItem = {
        key:
          itemIndex === undefined
            ? `${event.runId}:${event.sequence}`
            : (items[itemIndex]?.key ?? ""),
        label: stringDetail(event, "summary") ?? toolActivityLabel(stringDetail(event, "toolName")),
        ...optionalDetail(
          event.type === "tool_failed"
            ? stringDetail(event, "message")
            : stringDetail(event, "relativePath")
        ),
        status: event.type === "tool_failed" ? "failed" : "completed",
        statusLabel: event.type === "tool_failed" ? "失败" : "已完成"
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
    } else if (event.type === "change_set_auto_approved") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: "本次运行自动写入已授权",
        detail: `Change Set v${String(event.detail?.["revision"] ?? "")}`,
        status: "completed",
        statusLabel: "已授权"
      });
    } else if (event.type === "write_started") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: "正在写入已批准更改",
        status: "running",
        statusLabel: "写入中"
      });
    } else if (event.type === "write_applied") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: `版本点 ${stringDetail(event, "versionGroupId") ?? "已创建"}`,
        detail: "写入已完成，可从本次运行撤销。",
        status: "completed",
        statusLabel: "已写入"
      });
    } else if (event.type === "run_undo_review_required") {
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: "撤销需要逐文件审阅",
        status: "waiting",
        statusLabel: "待决定"
      });
    } else if (event.type === "run_undone") {
      const keptFiles = keptUndoFileCount(event);
      items.push({
        key: `${event.runId}:${event.sequence}`,
        label: keptFiles > 0 ? "撤销审阅已完成" : "本次运行已撤销",
        ...(keptFiles > 0 ? { detail: `保留 ${keptFiles} 个文件的当前内容` } : {}),
        status: "completed",
        statusLabel: "已完成"
      });
    }
  }
  return items;
}

function compareEvents(left: AgentRunEvent, right: AgentRunEvent): number {
  return left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt);
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

function keptUndoFileCount(event: AgentRunEvent): number {
  const versionGroup = event.detail?.["versionGroup"];
  if (typeof versionGroup !== "object" || versionGroup === null || Array.isArray(versionGroup)) {
    return 0;
  }
  const writes = (versionGroup as Record<string, unknown>)["writes"];
  if (!Array.isArray(writes)) return 0;
  return writes.filter(
    (write) =>
      typeof write === "object" &&
      write !== null &&
      !Array.isArray(write) &&
      (write as Record<string, unknown>)["status"] === "kept"
  ).length;
}

function optionalDetail(value: string | undefined): { readonly detail: string } | object {
  return value === undefined ? {} : { detail: value };
}
