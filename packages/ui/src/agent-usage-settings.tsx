import { Trash2 } from "lucide-react";
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
  const maxValue = Math.max(
    1,
    ...report.days.flatMap((day) => [day.inputTokens, day.outputTokens, day.cachedTokens])
  );
  const points = (key: "inputTokens" | "outputTokens" | "cachedTokens") =>
    report.days
      .map((day, index) => {
        const x = report.days.length === 1 ? 360 : 24 + (index * 672) / (report.days.length - 1);
        return `${x},${190 - (day[key] / maxValue) * 150}`;
      })
      .join(" ");
  const singleDay = report.days[0];
  const markerY = (value: number) => 190 - (value / maxValue) * 150;
  return (
    <figure className="agent-usage-chart">
      <figcaption>Token 用量趋势</figcaption>
      <div className="agent-usage-legend" aria-hidden="true">
        <span data-series="input">Input</span>
        <span data-series="output">Output</span>
        <span data-series="cached">Cached</span>
      </div>
      <svg aria-label="Token 用量趋势" role="img" viewBox="0 0 720 220">
        <line x1="24" x2="696" y1="190" y2="190" />
        <polyline data-series="input" points={points("inputTokens")} />
        <polyline data-series="output" points={points("outputTokens")} />
        <polyline data-series="cached" points={points("cachedTokens")} />
        {report.days.length === 1 && singleDay !== undefined ? (
          <>
            <circle cx="360" cy={markerY(singleDay.inputTokens)} data-series="input" r="3.5" />
            <circle cx="360" cy={markerY(singleDay.outputTokens)} data-series="output" r="3.5" />
            <circle cx="360" cy={markerY(singleDay.cachedTokens)} data-series="cached" r="3.5" />
          </>
        ) : null}
      </svg>
    </figure>
  );
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
            <th>Cached</th>
            <th>费用</th>
          </tr>
        </thead>
        <tbody>
          {report.days.map((day) => (
            <tr key={day.localDate}>
              <th scope="row">
                <button onClick={() => onSelectDay?.(day.localDate)} type="button">
                  {day.localDate}
                </button>
              </th>
              <td>{day.inputTokens.toLocaleString()}</td>
              <td>{day.outputTokens.toLocaleString()}</td>
              <td>{day.cachedTokens.toLocaleString()}</td>
              <td>
                {day.costs.map((cost) => (
                  <span className="agent-usage-cost" key={cost.currency}>
                    {cost.currency} 实际费用 {formatAmount(cost.actualAmount)} · 估算费用{" "}
                    {formatAmount(cost.estimatedAmount)}
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
                <th>用量状态</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>
              {report.runs.map((run) => (
                <tr key={run.usageId}>
                  <th scope="row">{run.runId}</th>
                  <td>
                    {run.provider} / {run.model}
                  </td>
                  <td>{run.projectId}</td>
                  <td>{run.totalTokens.toLocaleString()}</td>
                  <td>{statusLabel(run.usageStatus)}</td>
                  <td>
                    {run.cost.status === "unknown"
                      ? "未知费用"
                      : `${run.cost.currency} ${formatAmount(run.cost.amount)} (${run.cost.status === "actual" ? "实际费用" : "估算费用"})`}
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
function statusLabel(status: "actual" | "estimated" | "missing"): string {
  return status === "actual" ? "已报告" : status === "estimated" ? "估算" : "未知";
}
