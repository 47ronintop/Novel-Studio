import { ChevronDown, ShieldOff, ShieldCheck } from "lucide-react";
import type { AgentWritePolicy } from "@novel-studio/application";

import { AgentPopover } from "./agent-popover.js";
import type {
  AgentComposerPermissionControl
} from "./workspace-shell-types.js";

export interface AgentPermissionMenuProps {
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  readonly policyDisabled: boolean;
  readonly control?: AgentComposerPermissionControl;
  readonly onWritePolicyChange: (policy: AgentWritePolicy) => void;
  readonly onWritePolicyAcknowledgedChange: (acknowledged: boolean) => void;
}

export function AgentPermissionMenu(props: AgentPermissionMenuProps) {
  const automatic = props.writePolicy === "user_preapproved_run";
  const policyLabel = automatic ? "自动" : "只读";
  const PolicyIcon = automatic ? ShieldCheck : ShieldOff;

  return (
    <AgentPopover
      onOpenChange={(open) => {
        if (open) props.control?.onOpen();
      }}
      panelClassName="ns-agent-permission-popover"
      panelLabel="修改权限与摘要"
      triggerClassName="ns-agent-permission-trigger"
      triggerContent={
        <>
          <PolicyIcon aria-hidden="true" size={13} />
          <span>{policyLabel}</span>
          <ChevronDown aria-hidden="true" size={12} />
        </>
      }
      triggerLabel={`修改权限：${policyLabel}`}
      triggerTitle="修改权限与本次权限摘要"
    >
      {() => (
        <>
          <fieldset className="ns-agent-permission-policy">
            <legend>修改策略</legend>
            <label>
              <input
                checked={!automatic}
                disabled={props.policyDisabled}
                name="agent-write-policy"
                onChange={() => props.onWritePolicyChange("write_before_confirmation")}
                type="radio"
              />
              <span>
                <strong>每次修改前确认</strong>
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
                <strong>本次运行自动修改</strong>
                <small>只预授权当前 run，不扩大工具或路径范围。</small>
              </span>
            </label>
          </fieldset>

          {!automatic ? null : (
            <div className="ns-agent-permission-risk">
              <p>每次实际写入仍会生成差异、校验并创建版本点，可从本次运行撤销。</p>
              <label>
                <input
                  aria-label="确认本次运行自动修改风险"
                  checked={props.writePolicyAcknowledged}
                  disabled={props.policyDisabled}
                  onChange={(event) =>
                    props.onWritePolicyAcknowledgedChange(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>我理解此授权仅适用于本次运行。</span>
              </label>
            </div>
          )}

          <PermissionSummaryDetails
            {...(props.control === undefined ? {} : { control: props.control })}
          />
        </>
      )}
    </AgentPopover>
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
        <small>{control?.loading ? "读取中" : summary === undefined ? "尚未生成" : "服务端事实"}</small>
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
            <dd>{summary.proposalCapabilities.length > 0 ? "允许生成，仍需走审批管线" : "不适用"}</dd>
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
            <dd>{summary.checksum.slice(0, 12)} · registry {summary.toolRegistryRevision.slice(0, 8)}</dd>
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
