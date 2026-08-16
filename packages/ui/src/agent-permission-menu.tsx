import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import type { AgentContextMode, AgentWritePolicy } from "@novel-studio/application";

import type { AgentComposerPermissionControl } from "./workspace-shell-types.js";

export interface AgentPermissionMenuProps {
  readonly writePolicy: AgentWritePolicy;
  readonly policyDisabled: boolean;
  readonly title?: string;
  readonly notice?: string;
  readonly control?: AgentComposerPermissionControl;
  readonly onWritePolicyChange: (policy: AgentWritePolicy) => void;
}

export function AgentPermissionMenu(props: AgentPermissionMenuProps) {
  const automatic = props.writePolicy === "user_preapproved_run";
  const title = props.title ?? "执行审批";

  return (
    <section aria-label={title} className="ns-agent-permission-menu">
      <fieldset className="ns-agent-permission-policy">
        <legend>{title}</legend>
        {props.notice === undefined ? null : <p>{props.notice}</p>}
        <label>
          <input
            checked={!automatic}
            disabled={props.policyDisabled}
            name="agent-write-policy"
            onChange={() => props.onWritePolicyChange("write_before_confirmation")}
            type="radio"
          />
          <ShieldAlert aria-hidden="true" className="ns-agent-permission-choice-icon" size={16} />
          <span>
            <strong>请求批准</strong>
            <small>每个 Change Set 都先进入差异审阅。</small>
          </span>
          {!automatic ? (
            <Check aria-hidden="true" className="ns-agent-permission-choice-check" size={15} />
          ) : null}
        </label>
        <label>
          <input
            checked={automatic}
            disabled
            name="agent-write-policy"
            onChange={() => props.onWritePolicyChange("user_preapproved_run")}
            type="radio"
          />
          <ShieldCheck aria-hidden="true" className="ns-agent-permission-choice-icon" size={16} />
          <span>
            <strong>替我审批</strong>
            <small>可信确认尚不可用。</small>
          </span>
          {automatic ? (
            <Check aria-hidden="true" className="ns-agent-permission-choice-check" size={15} />
          ) : null}
        </label>
      </fieldset>

      <PermissionSummaryDetails
        {...(props.control === undefined ? {} : { control: props.control })}
      />
    </section>
  );
}

function PermissionSummaryDetails({
  control
}: {
  readonly control?: AgentComposerPermissionControl;
}) {
  const summary = control?.summary ?? control?.capability?.permissionSummary;
  return (
    <details aria-label="本次权限摘要" className="ns-agent-permission-summary">
      <summary>
        <span>本次权限摘要</span>
        <small>
          {control?.loading ? "读取中" : summary === undefined ? "尚未生成" : "服务端事实"}
        </small>
      </summary>
      {control?.errorMessage === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {control.errorMessage}
        </p>
      )}
      {summary === undefined ? (
        <p>{control?.loading ? "正在读取权限摘要…" : "发送前打开此菜单即可生成摘要。"}</p>
      ) : (
        <dl>
          <div>
            <dt>作用范围</dt>
            <dd>仅当前项目，不访问项目外路径</dd>
          </div>
          <div>
            <dt>审批状态</dt>
            <dd>{approvalLabel(control?.approvalSource ?? "not_approved")}</dd>
          </div>
          <div>
            <dt>可读取</dt>
            <dd>{readScopeLabel(summary.contextMode, summary.readCapabilities.length > 0)}</dd>
          </div>
          <div>
            <dt>修改能力</dt>
            <dd>
              {writeScopeLabel(
                summary.proposalCapabilities.length > 0,
                control?.approvalSource ?? "not_approved"
              )}
            </dd>
          </div>
          <div>
            <dt>安全边界</dt>
            <dd>{forbiddenSummary(summary.forbiddenCapabilities)}</dd>
          </div>
        </dl>
      )}
    </details>
  );
}

function approvalLabel(source: AgentComposerPermissionControl["approvalSource"]): string {
  switch (source) {
    case "not_applicable":
      return "无需写入审批";
    case "human_confirmation":
      return "已人工确认";
    case "user_preapproved_run":
      return "本次运行有限预授权";
    default:
      return "尚未批准";
  }
}

function readScopeLabel(contextMode: AgentContextMode, canRead: boolean): string {
  if (!canRead) return "无";
  return contextMode === "writing"
    ? "项目内的章节、故事资料与支持的文本文件"
    : "项目内支持的文本文件";
}

function writeScopeLabel(
  canPropose: boolean,
  approvalSource: AgentComposerPermissionControl["approvalSource"]
): string {
  if (!canPropose) return "只读，不会修改文件";
  switch (approvalSource) {
    case "human_confirmation":
      return "可生成修改建议；本次写入已由你确认";
    case "user_preapproved_run":
      return "可生成修改建议；本次运行按有限预授权执行";
    default:
      return "可生成修改建议；写入前仍需审批";
  }
}

function forbiddenSummary(capabilities: readonly string[]): string {
  const values = new Set(capabilities);
  const tools = [
    values.has("shell") ? "Shell" : undefined,
    values.has("git") ? "Git" : undefined,
    values.has("network") ? "网络" : undefined,
    values.has("remote_mcp") ? "远程 MCP" : undefined
  ].filter((value): value is string => value !== undefined);
  const fileActions = [
    values.has("delete") ? "删除文件" : undefined,
    values.has("move") ? "移动文件" : undefined,
    values.has("rename") ? "重命名文件" : undefined,
    values.has("create_directory") ? "创建目录" : undefined
  ].filter((value): value is string => value !== undefined);
  const known = new Set([
    "shell",
    "git",
    "network",
    "remote_mcp",
    "delete",
    "move",
    "rename",
    "create_directory"
  ]);
  const parts = [
    tools.length === 0 ? undefined : `不可直接使用：${joinChinese(tools)}`,
    fileActions.length === 0 ? undefined : `不能直接${joinChinese(fileActions)}`,
    capabilities.some((capability) => !known.has(capability)) ? "另有未授权能力不可用" : undefined
  ].filter((value): value is string => value !== undefined);
  return parts.join("；") || "未列出额外限制";
}

function joinChinese(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join("、")}或${values.at(-1)}`;
}
