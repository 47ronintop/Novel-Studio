import { Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { AgentUsageReport } from "@novel-studio/application";

export type AgentUsageRangePreset = "today" | "7d" | "30d";
export interface AgentUsageFilters {
  readonly provider: string;
  readonly model: string;
  readonly projectId: string;
}
export interface AgentUsageSettingsProps {
  readonly status: "idle" | "loading" | "loaded" | "error";
  readonly rangePreset: AgentUsageRangePreset;
  readonly filters: AgentUsageFilters;
  readonly report?: AgentUsageReport;
  readonly feedback?: { readonly kind: "info" | "error"; readonly message: string } | undefined;
  readonly onRangePresetChange?: (preset: AgentUsageRangePreset) => void;
  readonly onFiltersChange?: (filters: Partial<AgentUsageFilters>) => void;
  readonly onSelectDay?: (localDate: string) => void;
  readonly onClear?: () => void;
}

const rangeOptions = [
  { id: "today", label: "今日" },
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" }
] as const;

export function AgentUsageSettings(props: AgentUsageSettingsProps) {
  const days = props.report?.days ?? [];
  return (
    <section className="agent-usage-settings" aria-labelledby="agent-usage-heading">
      <header className="model-settings-section-header">
        <div>
          <h2 id="agent-usage-heading">Agent 用量</h2>
        </div>
        <button
          className="ns-icon-text-button"
          disabled={props.status === "loading" || props.report === undefined}
          onClick={props.onClear}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} />
          清除所选范围用量
        </button>
      </header>
      <div aria-label="用量日期范围" className="agent-usage-range" role="group">
        {rangeOptions.map((option) => (
          <button
            aria-pressed={props.rangePreset === option.id}
            key={option.id}
            onClick={() => props.onRangePresetChange?.(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="agent-usage-filters">
        <UsageFilter
          label="Provider"
          onChange={(provider) => props.onFiltersChange?.({ provider })}
          value={props.filters.provider}
        />
        <UsageFilter
          label="Model"
          onChange={(model) => props.onFiltersChange?.({ model })}
          value={props.filters.model}
        />
        <UsageFilter
          label="Project"
          onChange={(projectId) => props.onFiltersChange?.({ projectId })}
          value={props.filters.projectId}
        />
      </div>
      {props.feedback === undefined ? null : (
        <p
          className="ns-project-feedback"
          data-kind={props.feedback.kind}
          role={props.feedback.kind === "error" ? "alert" : "status"}
        >
          {props.feedback.message}
        </p>
      )}
      {props.status === "loading" ? <p role="status">正在读取 Agent 用量...</p> : null}
      {props.status === "loaded" && days.length === 0 ? (
        <p className="agent-usage-empty">所选范围暂无 Agent 用量记录。</p>
      ) : null}
      {days.length > 0 && props.report !== undefined ? (
        <>
          <UsageChart report={props.report} />
          <DailyUsageTable report={props.report} onSelectDay={props.onSelectDay} />
          <RunDetails report={props.report} />
        </>
      ) : null}
    </section>
  );
}

function UsageFilter({
  label,
  onChange,
  value
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={`${label} 筛选`}
        className="ns-search-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="全部"
        value={value}
      />
    </label>
  );
}

function UsageChart({ report }: { readonly report: AgentUsageReport }) {
  const hourly =
    report.query.range.fromLocalDate === report.query.range.toLocalDate && report.runs.length > 0;
  const buckets = hourly ? hourlyUsageBuckets(report) : dailyUsageBuckets(report);
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.totalTokens));
  const modelKeys = [
    ...new Set(buckets.flatMap((bucket) => bucket.segments.map((segment) => segment.key)))
  ];
  const modelLabels = new Map(
    buckets.flatMap((bucket) =>
      bucket.segments.map((segment) => [segment.key, segment.label] as const)
    )
  );
  return (
    <figure className="agent-usage-chart" data-chart-kind={hourly ? "hourly" : "daily"}>
      <figcaption>{hourly ? "Token 用量（按小时）" : "Token 用量（按天）"}</figcaption>
      <ul aria-label="模型颜色图例" className="agent-usage-legend">
        {modelKeys.map((key, index) => (
          <li key={key}>
            <span
              aria-hidden="true"
              className="agent-usage-legend-swatch"
              style={usageColorStyle(index)}
            />
            <span>{modelLabels.get(key) ?? key}</span>
          </li>
        ))}
      </ul>
      <div className="agent-usage-chart-body">
        <div aria-hidden="true" className="agent-usage-scale">
          <span>{formatCompactTokens(maxValue)}</span>
          <span>0</span>
        </div>
        <div
          aria-label={hourly ? "每小时 Agent Token 柱状图" : "每日 Agent Token 柱状图"}
          className="agent-usage-bar-plot"
          role="img"
        >
          {buckets.map((bucket) => (
            <div className="agent-usage-bar-column" key={bucket.key}>
              <div className="agent-usage-bar-track">
                {bucket.totalTokens === 0 ? null : (
                  <div
                    className="agent-usage-bar-stack"
                    style={{ height: `${Math.max(2, (bucket.totalTokens / maxValue) * 100)}%` }}
                    title={`${bucket.label} · ${bucket.totalTokens.toLocaleString()} tokens`}
                  >
                    {bucket.segments.map((segment) => {
                      const colorIndex = modelKeys.indexOf(segment.key);
                      return (
                        <span
                          className="agent-usage-bar-segment"
                          data-model-key={segment.key}
                          key={segment.key}
                          style={{
                            ...usageColorStyle(Math.max(0, colorIndex)),
                            flexGrow: Math.max(1, segment.totalTokens)
                          }}
                          title={`${segment.label} · ${segment.totalTokens.toLocaleString()} tokens`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="agent-usage-bar-label">{bucket.showLabel ? bucket.label : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

interface UsageChartSegment {
  readonly key: string;
  readonly label: string;
  readonly totalTokens: number;
}

interface UsageChartBucket {
  readonly key: string;
  readonly label: string;
  readonly showLabel: boolean;
  readonly totalTokens: number;
  readonly segments: readonly UsageChartSegment[];
}

const USAGE_MODEL_COLORS = [
  "#c65345",
  "#3f8581",
  "#4d78a8",
  "#b17a28",
  "#66864f",
  "#9a5f8f",
  "#69707d",
  "#bb6b4a"
] as const;

function dailyUsageBuckets(report: AgentUsageReport): UsageChartBucket[] {
  const labelEvery = Math.max(1, Math.ceil(report.days.length / 8));
  return report.days.map((day, index) => {
    const fallbackLabel = report.query.model ?? "全部模型";
    const models =
      day.models !== undefined && day.models.length > 0
        ? day.models.map((model) => ({
            key: `${model.provider}/${model.model}`,
            label: model.model,
            totalTokens: model.totalTokens
          }))
        : [
            {
              key: `${report.query.provider ?? "all"}/${report.query.model ?? "all"}`,
              label: fallbackLabel,
              totalTokens: day.totalTokens
            }
          ];
    return {
      key: day.localDate,
      label: day.localDate.slice(5),
      showLabel: index % labelEvery === 0 || index === report.days.length - 1,
      totalTokens: day.totalTokens,
      segments: models.filter((model) => model.totalTokens > 0)
    };
  });
}

function hourlyUsageBuckets(report: AgentUsageReport): UsageChartBucket[] {
  const hours = Array.from({ length: 24 }, () => new Map<string, UsageChartSegment>());
  for (const run of report.runs) {
    const timestamp = new Date(run.timestamp);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const key = `${run.provider}/${run.model}`;
    const bucket = hours[timestamp.getHours()];
    if (bucket === undefined) continue;
    const prior = bucket.get(key);
    bucket.set(key, {
      key,
      label: run.model,
      totalTokens: (prior?.totalTokens ?? 0) + run.totalTokens
    });
  }
  return hours.map((segments, hour) => {
    const values = [...segments.values()].sort(
      (left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label)
    );
    return {
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      showLabel: hour % 3 === 0 || hour === 23,
      totalTokens: values.reduce((sum, segment) => sum + segment.totalTokens, 0),
      segments: values
    };
  });
}

function usageColorStyle(index: number): CSSProperties {
  return {
    "--usage-color": USAGE_MODEL_COLORS[index % USAGE_MODEL_COLORS.length]
  } as CSSProperties;
}

function formatCompactTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function DailyUsageTable({
  report,
  onSelectDay
}: {
  readonly report: AgentUsageReport;
  readonly onSelectDay: AgentUsageSettingsProps["onSelectDay"];
}) {
  return (
    <div className="agent-usage-table-wrap">
      <table aria-label="每日 Agent 用量明细" className="agent-usage-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>Input</th>
            <th>Output</th>
            <th>缓存读取</th>
            <th>缓存写入</th>
            <th>可缓存输入</th>
            <th>命中率</th>
            <th>费用</th>
          </tr>
        </thead>
        <tbody>
          {report.days.map((day) => (
            <tr key={day.localDate}>
              <th data-label="日期" scope="row">
                <button onClick={() => onSelectDay?.(day.localDate)} type="button">
                  {day.localDate}
                </button>
              </th>
              <td data-label="Input">{day.inputTokens.toLocaleString()}</td>
              <td data-label="Output">{day.outputTokens.toLocaleString()}</td>
              <td data-label="缓存读取">
                {formatTokenCount(day.cacheReadTokens ?? day.cachedTokens)}
              </td>
              <td data-label="缓存写入">{formatTokenCount(day.cacheWriteTokens)}</td>
              <td data-label="可缓存输入">{formatTokenCount(day.cacheEligibleInputTokens)}</td>
              <td data-label="命中率">{formatCacheHitRate(day.cacheHitRate)}</td>
              <td data-label="费用">
                {day.costs.map((cost) => (
                  <span className="agent-usage-cost" key={cost.currency}>
                    {cost.currency} 实际费用 {formatAmount(cost.actualAmount)} · 估算费用{" "}
                    {formatAmount(cost.estimatedAmount)}
                    {cost.estimatedCacheSavings === undefined
                      ? null
                      : ` · 缓存节省 ${formatAmount(cost.estimatedCacheSavings)}`}
                  </span>
                ))}
                {day.hasUnknownCost ? <span className="agent-usage-unknown">未知费用</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunDetails({ report }: { readonly report: AgentUsageReport }) {
  if (report.query.detailLocalDate === undefined) return null;
  return (
    <section className="agent-usage-runs" aria-labelledby="agent-usage-runs-heading">
      <h3 id="agent-usage-runs-heading">{report.query.detailLocalDate} 运行记录</h3>
      {report.runs.length === 0 ? (
        <p>该日没有匹配的运行记录。</p>
      ) : (
        <div className="agent-usage-table-wrap">
          <table aria-label="所选日期 Agent 运行记录" className="agent-usage-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Provider / Model</th>
                <th>Project</th>
                <th>Tokens</th>
                <th>缓存</th>
                <th>用量状态</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>
              {report.runs.map((run) => (
                <tr key={run.usageId}>
                  <th data-label="Run" scope="row">
                    {run.runId}
                  </th>
                  <td data-label="Provider / Model">
                    {run.provider} / {run.model}
                  </td>
                  <td data-label="Project">
                    {run.scope.kind === "standalone" ? "Standalone" : run.projectId}
                  </td>
                  <td data-label="Tokens">{run.totalTokens.toLocaleString()}</td>
                  <td data-label="缓存">
                    <div>模式：{cacheModeLabel(run.cacheMode)}</div>
                    <div>
                      结果：{cacheOutcomeLabel(run.cacheOutcome)}
                      {run.cacheBypassReason === undefined
                        ? null
                        : `（${cacheBypassReasonLabel(run.cacheBypassReason)}）`}
                    </div>
                    <div>
                      读取 {formatTokenCount(run.cacheReadTokens)} · 写入{" "}
                      {formatTokenCount(run.cacheWriteTokens)} · 可缓存输入{" "}
                      {formatTokenCount(run.cacheEligibleInputTokens)}
                    </div>
                    <div>命中率：{formatCacheHitRate(run.cacheHitRate)}</div>
                    <div>缓存用量：{cacheUsageStatusLabel(run.cacheUsageStatus)}</div>
                    <div>
                      输入口径：{cacheInputTokenSemanticsLabel(run.cacheInputTokenSemantics)}
                    </div>
                    <div>Prefix：{shortPrefixChecksum(run.cachePrefixChecksum)}</div>
                  </td>
                  <td data-label="用量状态">{statusLabel(run.usageStatus)}</td>
                  <td data-label="费用">
                    {run.cost.status === "unknown"
                      ? "未知费用"
                      : `${run.cost.currency} ${formatAmount(run.cost.amount)} (${run.cost.status === "actual" ? "实际费用" : "估算费用"})`}
                    {run.estimatedCacheSavings === undefined
                      ? null
                      : ` · 缓存节省 ${run.estimatedCacheSavings.currency} ${formatAmount(run.estimatedCacheSavings.amount)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatAmount(amount: number): string {
  return amount.toFixed(4);
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "不可用" : value.toLocaleString();
}

function formatCacheHitRate(value: number | undefined): string {
  return value === undefined
    ? "不可用"
    : new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function cacheModeLabel(
  mode:
    "none" | "automatic_prefix" | "explicit_breakpoints" | "explicit_resource" | null | undefined
): string {
  switch (mode) {
    case "none":
      return "无";
    case "automatic_prefix":
      return "自动前缀";
    case "explicit_breakpoints":
      return "显式断点";
    case "explicit_resource":
      return "显式资源";
    case null:
      return "不可用";
    default:
      return "不可用";
  }
}

function cacheOutcomeLabel(outcome: "hit" | "miss" | "bypass" | "unknown" | undefined): string {
  return outcome === "hit"
    ? "命中"
    : outcome === "miss"
      ? "未命中"
      : outcome === "bypass"
        ? "跳过"
        : "未知";
}

function cacheBypassReasonLabel(
  reason:
    | "policy_none"
    | "unsupported_provider"
    | "below_minimum_tokens"
    | "identity_unverified"
    | "resource_unavailable"
    | "resource_create_failed"
    | "resource_expired"
    | "cache_error"
    | "usage_unavailable"
): string {
  const labels = {
    policy_none: "策略未启用",
    unsupported_provider: "Provider 不支持",
    below_minimum_tokens: "低于最小 token 数",
    identity_unverified: "身份未验证",
    resource_unavailable: "资源不可用",
    resource_create_failed: "资源创建失败",
    resource_expired: "资源已过期",
    cache_error: "缓存错误",
    usage_unavailable: "用量不可用"
  } as const;
  return labels[reason];
}

function cacheUsageStatusLabel(status: "actual" | "derived" | "unavailable" | undefined): string {
  return status === "actual" ? "实际" : status === "derived" ? "推导" : "不可用";
}

function cacheInputTokenSemanticsLabel(
  semantics: "included_in_input" | "excluded_from_input" | "unavailable" | undefined
): string {
  return semantics === "included_in_input"
    ? "计入输入"
    : semantics === "excluded_from_input"
      ? "不计入输入"
      : "不可用";
}

function shortPrefixChecksum(checksum: string | null | undefined): string {
  if (checksum === null) return "不可用";
  if (typeof checksum !== "string" || checksum.length < 14) return "不可用";
  return `${checksum.slice(0, 8)}...${checksum.slice(-6)}`;
}

function statusLabel(status: "actual" | "estimated" | "missing"): string {
  return status === "actual" ? "已报告" : status === "estimated" ? "估算" : "未知";
}
