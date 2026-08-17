import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { AgentUsageDailyBucket, AgentUsageReport } from "@novel-studio/application";

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
    <section
      className="model-settings-section agent-usage-settings"
      aria-labelledby="agent-usage-heading"
    >
      <header className="model-settings-section-header">
        <div>
          <h2 id="agent-usage-heading">Agent 用量</h2>
          <p>查看总量、输入、输出与缓存用量；详细记录仅保留写作决策需要的信息。</p>
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
      <div aria-label="用量筛选" className="agent-usage-controls" role="group">
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
          <UsageSummary days={days} report={props.report} />
          <UsageChart report={props.report} />
          <DailyUsageTable report={props.report} onSelectDay={props.onSelectDay} />
          <RunDetails report={props.report} />
        </>
      ) : null}
    </section>
  );
}

function UsageSummary({
  days,
  report
}: {
  readonly days: readonly AgentUsageDailyBucket[];
  readonly report: AgentUsageReport;
}) {
  const summary = summarizeUsage(days);
  const cacheTelemetry = summarizeCacheTelemetry(
    // The application report gains these optional aggregate fields alongside the
    // existing daily/run data. Keep this UI tolerant while older reports load.
    report
  );
  return (
    <section aria-label="用量摘要" className="agent-usage-summary">
      <h3>用量摘要</h3>
      <div className="agent-usage-summary-grid">
        <UsageSummaryCard label="总 Token" value={summary.totalTokens.toLocaleString()} />
        <UsageSummaryCard label="输入" value={summary.inputTokens.toLocaleString()} />
        <UsageSummaryCard label="输出" value={summary.outputTokens.toLocaleString()} />
        <UsageSummaryCard
          label="缓存读取"
          secondary={cacheTelemetry.label}
          secondaryStatus={cacheTelemetry.status}
          value={formatTokenCount(summary.cacheReadTokens)}
        />
      </div>
    </section>
  );
}

function UsageSummaryCard({
  label,
  value,
  secondary,
  secondaryStatus
}: {
  readonly label: string;
  readonly value: string;
  readonly secondary?: string;
  readonly secondaryStatus?: CacheTelemetryStatus;
}) {
  return (
    <article className="agent-usage-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {secondary === undefined ? null : (
        <small className="agent-usage-summary-secondary" data-telemetry-status={secondaryStatus}>
          {secondary}
        </small>
      )}
    </article>
  );
}

interface UsageSummaryValues {
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

function summarizeUsage(days: readonly AgentUsageDailyBucket[]): UsageSummaryValues {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  for (const day of days) {
    totalTokens += day.totalTokens;
    inputTokens += day.inputTokens;
    outputTokens += day.outputTokens;
    cacheReadTokens += day.cacheReadTokens ?? day.cachedTokens;
  }

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens
  };
}

type CacheTelemetryStatus = "complete" | "partial" | "unavailable";

function summarizeCacheTelemetry(report: AgentUsageReport): {
  readonly status: CacheTelemetryStatus;
  readonly label: string;
} {
  const coverage = report.cacheTelemetryCoverage;
  const share = report.cacheTokenShare;

  if (coverage === 1 && share !== undefined) {
    return { status: "complete", label: `占比 ${formatPercent(share)}` };
  }
  if (coverage !== undefined && coverage > 0 && coverage < 1) {
    return { status: "partial", label: "数据不完整" };
  }
  return { status: "unavailable", label: "未上报" };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
    <section className="agent-usage-detail-section" aria-labelledby="agent-usage-daily-heading">
      <header className="agent-usage-subsection-header">
        <div>
          <h3 id="agent-usage-daily-heading">每日明细</h3>
          <p>点击日期查看当天的精简运行记录。</p>
        </div>
      </header>
      <div className="agent-usage-table-wrap">
        <table aria-label="每日 Agent 用量明细" className="agent-usage-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>总 Token</th>
              <th>输入</th>
              <th>输出</th>
              <th>缓存</th>
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
                <td data-label="总 Token">
                  <strong className="agent-usage-table-primary">
                    {day.totalTokens.toLocaleString()}
                  </strong>
                </td>
                <td data-label="输入">
                  <span className="agent-usage-table-secondary">
                    {day.inputTokens.toLocaleString()}
                  </span>
                </td>
                <td data-label="输出">
                  <span className="agent-usage-table-secondary">
                    {day.outputTokens.toLocaleString()}
                  </span>
                </td>
                <td data-label="缓存">
                  <span className="agent-usage-table-secondary">
                    {formatTokenCount(day.cacheReadTokens ?? day.cachedTokens)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunDetails({ report }: { readonly report: AgentUsageReport }) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(report.runs.length / pageSize));
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [report]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  if (report.query.detailLocalDate === undefined) return null;

  const visibleRuns = report.runs.slice((page - 1) * pageSize, page * pageSize);
  return (
    <section className="agent-usage-runs" aria-labelledby="agent-usage-runs-heading">
      <header className="agent-usage-subsection-header">
        <div>
          <h3 id="agent-usage-runs-heading">{report.query.detailLocalDate} 运行记录</h3>
          <p>每条仅显示模型、总 Token 和缓存结果。</p>
        </div>
        <span>{report.runs.length.toLocaleString()} 条</span>
      </header>
      {report.runs.length === 0 ? (
        <p>该日没有匹配的运行记录。</p>
      ) : (
        <>
          <ol aria-label="所选日期 Agent 运行记录" className="agent-usage-run-list">
            {visibleRuns.map((run) => (
              <li className="agent-usage-run-card" key={run.usageId}>
                <div className="agent-usage-run-identity">
                  <div>
                    <strong>{run.model}</strong>
                    <span>{run.provider}</span>
                  </div>
                  <time dateTime={run.timestamp}>{formatRunTime(run.timestamp)}</time>
                </div>
                <dl className="agent-usage-run-metrics">
                  <div>
                    <dt>Token</dt>
                    <dd>
                      <strong>{run.totalTokens.toLocaleString()}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>缓存</dt>
                    <dd>{formatRunCache(run)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
          <nav aria-label="运行记录分页" className="agent-usage-pagination">
            <span>
              第 {page} / {totalPages} 页 · 共 {report.runs.length.toLocaleString()} 条
            </span>
            <button
              aria-label="上一页运行记录"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              title="上一页"
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="下一页运行记录"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              title="下一页"
              type="button"
            >
              <ChevronRight aria-hidden="true" size={14} />
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "不可用" : value.toLocaleString();
}

function formatRunTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

function formatRunCache(run: AgentUsageReport["runs"][number]): string {
  if (run.cacheOutcome === "hit" && run.cacheReadTokens !== undefined) {
    return `命中 · 读取 ${formatTokenCount(run.cacheReadTokens)}`;
  }
  if (run.cacheOutcome === "hit") return "命中";
  if (run.cacheOutcome === "miss") return "未命中";
  if (run.cacheOutcome === "bypass" && run.cacheBypassReason === "policy_none") {
    return "未启用";
  }
  if (run.cacheOutcome === "bypass" && run.cacheBypassReason === "below_minimum_tokens") {
    return "低于门槛";
  }
  return (run.cacheOutcome === "unknown" || run.cacheOutcome === undefined) &&
    run.cacheMode === null
    ? "未上报（旧记录）"
    : "未上报";
}
