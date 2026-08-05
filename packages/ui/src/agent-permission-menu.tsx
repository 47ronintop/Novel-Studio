import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import type { AgentWritePolicy } from "@novel-studio/application";

import type { AgentComposerPermissionControl } from "./workspace-shell-types.js";
import { AgentCapabilitySummary, operationLabel } from "./agent-capability-summary.js";

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
      {control?.capability === undefined ? null : (
        <AgentCapabilitySummary
          ariaLabel="能力目录与审批规则"
          facts={control.capability}
        />
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
          {summary.schemaVersion === "1.1" || summary.schemaVersion === "2.0" ? (
            <div>
              <dt>写入后端</dt>
              <dd>{writeMutationTrustLabel(summary.writeMutationTrust)}</dd>
            </div>
          ) : null}
          {summary.schemaVersion === "2.0" ? (
            <>
              <div>
                <dt>写作操作</dt>
                <dd>{summary.writingOperations.map(operationLabel).join("、") || "无"}</dd>
              </div>
              <div>
                <dt>文件操作</dt>
                <dd>{summary.workspaceFileOperations.map(operationLabel).join("、") || "无"}</dd>
              </div>
              <div>
                <dt>规则集</dt>
                <dd>
                  {summary.approvalRuleSetVersion === "not_applicable"
                    ? "不适用"
                    : `${summary.approvalRuleSetVersion} · ${summary.approvalRules.length} 项`}
                </dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>审批状态</dt>
            <dd>{approvalLabel(control?.approvalSource ?? "not_approved")}</dd>
          </div>
          <div>
            <dt>明确不可用</dt>
            <dd>{summary.forbiddenCapabilities.map(forbiddenLabel).join("、") || "无"}</dd>
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
      return "本次运行有限预授权";
    default:
      return "尚未批准";
  }
}

function writeMutationTrustLabel(
  trust: "unavailable" | "standard_trusted_creative" | "hardened_native" | undefined
): string {
  switch (trust) {
    case "standard_trusted_creative":
      return "标准可信创作（standard trusted creative）· 不抵御同权限本地进程的路径竞争";
    case "hardened_native":
      return "强化原生（hardened native）";
    case "unavailable":
      return "不可用";
    default:
      return "旧记录未声明";
  }
}
