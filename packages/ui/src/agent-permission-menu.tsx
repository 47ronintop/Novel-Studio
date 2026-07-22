import type { AgentWritePolicy } from "@novel-studio/application";

import type { AgentComposerPermissionControl } from "./workspace-shell-types.js";

export interface AgentPermissionMenuProps {
  readonly writePolicy: AgentWritePolicy;
  readonly policyDisabled: boolean;
  readonly control?: AgentComposerPermissionControl;
  readonly onWritePolicyChange: (policy: AgentWritePolicy) => void;
}

export function AgentPermissionMenu(props: AgentPermissionMenuProps) {
  const automatic = props.writePolicy === "user_preapproved_run";

  return (
    <section aria-label="执行审批" className="ns-agent-permission-menu">
      <fieldset className="ns-agent-permission-policy">
        <legend>执行审批</legend>
        <label>
          <input
            checked={!automatic}
            disabled={props.policyDisabled}
            name="agent-write-policy"
            onChange={() => props.onWritePolicyChange("write_before_confirmation")}
            type="radio"
          />
          <span>
            <strong>请求批准</strong>
            <small>每个 Change Set 都先进入差异审阅。</small>
          </span>
        </label>
        <label>
          <input
            checked={automatic}
            disabled={props.policyDisabled}
            name="agent-write-policy"
            onChange={() => props.onWritePolicyChange("user_preapproved_run")}
            type="radio"
          />
          <span>
            <strong>替我审批</strong>
            <small>只预授权当前运行，不扩大工具或路径范围。</small>
          </span>
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
  const summary = control?.summary;
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
            <dt>项目范围</dt>
            <dd>当前项目根目录 · 仅项目内相对路径</dd>
          </div>
          <div>
            <dt>上下文</dt>
            <dd>{summary.contextMode === "writing" ? "写作上下文" : "文件上下文"}</dd>
          </div>
          <div>
            <dt>可读取</dt>
            <dd>{capabilityList(summary.readCapabilities)}</dd>
          </div>
          <div>
            <dt>可提案</dt>
            <dd>{capabilityList(summary.proposalCapabilities)}</dd>
          </div>
          <div>
            <dt>Change Set</dt>
            <dd>
              {summary.proposalCapabilities.length > 0 ? "允许生成，仍需走审批管线" : "不适用"}
            </dd>
          </div>
          <div>
            <dt>审批状态</dt>
            <dd>{approvalLabel(control?.approvalSource ?? "not_approved")}</dd>
          </div>
          <div>
            <dt>明确不可用</dt>
            <dd>{summary.forbiddenCapabilities.map(forbiddenLabel).join("、")}</dd>
          </div>
          <div>
            <dt>事实绑定</dt>
            <dd>
              {summary.checksum.slice(0, 12)} · registry {summary.toolRegistryRevision.slice(0, 8)}
            </dd>
          </div>
        </dl>
      )}
    </details>
  );
}

function capabilityList(capabilities: readonly string[]): string {
  return capabilities.length === 0 ? "无" : capabilities.join("、");
}

function forbiddenLabel(capability: string): string {
  switch (capability) {
    case "shell":
      return "Shell";
    case "git":
      return "Git";
    case "network":
      return "网络";
    case "delete":
      return "删除";
    case "move":
      return "移动";
    case "rename":
      return "重命名";
    case "create_directory":
      return "创建目录";
    default:
      return capability;
  }
}

function approvalLabel(source: AgentComposerPermissionControl["approvalSource"]): string {
  switch (source) {
    case "not_applicable":
      return "不适用";
    case "human_confirmation":
      return "人工确认";
    case "user_preapproved_run":
      return "本次运行预授权";
    default:
      return "尚未批准";
  }
}
