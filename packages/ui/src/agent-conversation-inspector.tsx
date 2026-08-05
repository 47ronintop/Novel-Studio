import type { AgentContextMode, AgentContextProfileId } from "@novel-studio/application";

import type { AgentConversationViewProps } from "./workspace-shell-types.js";
import { AgentCapabilitySummary, describeAgentCapabilities } from "./agent-capability-summary.js";

export function AgentConversationInspector({
  view
}: {
  readonly view: AgentConversationViewProps;
}) {
  const run = view.agentRun;
  const composer = view.composer;
  const capability = run?.capability ?? composer?.capability;
  const capabilityDescription =
    capability === undefined ? undefined : describeAgentCapabilities(capability);
  return (
    <>
      {capability === undefined ? null : (
        <AgentCapabilitySummary
          ariaLabel="Agent Inspector 能力摘要"
          compact
          facts={capability}
        />
      )}
      <dl className="ns-meta-list" aria-label="Agent 运行检查器">
        <div>
          <dt>会话</dt>
          <dd>{view.conversation?.title ?? "未选择"}</dd>
        </div>
        <div>
          <dt>运行</dt>
          <dd>{run?.runId ?? "尚未运行"}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{run?.status ?? "idle"}</dd>
        </div>
        <div>
          <dt>模式</dt>
          <dd>
            {composer?.operationMode === "conversation"
              ? "会话"
              : composer?.operationMode === "execution"
                ? "执行"
                : "规划"}
          </dd>
        </div>
        <div>
          <dt>工作台</dt>
          <dd>{capabilityDescription?.profileLabel ?? "未确定"}</dd>
        </div>
        <div>
          <dt>能力</dt>
          <dd>{capabilityDescription?.modeLabel ?? "未生成"}</dd>
        </div>
        <div>
          <dt>上下文</dt>
          <dd>{contextLabel(composer?.contextMode, capability?.profileId)}</dd>
        </div>
        <div>
          <dt>写入策略</dt>
          <dd>
            {composer?.operationMode === "planning"
              ? `当前 Plan 只读 · 未来 Act ${
                  composer.executionWritePolicyDraft === "user_preapproved_run"
                    ? "有限替我审批"
                    : "请求批准"
                }`
              : composer?.writePolicy === "user_preapproved_run"
                ? "本次运行有限预授权"
                : "写入前确认"}
          </dd>
        </div>
      </dl>
      {run?.sendLedger === undefined ? null : (
        <section className="ns-agent-send-ledger" aria-label="发送账本">
          <h3>发送账本</h3>
          {run.sendLedger.length === 0 ? (
            <p>尚未发送</p>
          ) : (
            <ol>
              {run.sendLedger.map((entry) => (
                <li key={entry.entryId}>
                  <div className="ns-agent-send-ledger-heading">
                    <strong>
                      {entry.roundKind === "first_send"
                        ? "首轮预览绑定"
                        : `Round ${entry.roundNumber + 1} · 本轮新增 ${entry.additions.length} 项`}
                    </strong>
                    <span>{entry.sentAtLabel}</span>
                  </div>
                  <code title={entry.canonicalRoundManifestChecksum}>
                    Manifest {compactChecksum(entry.canonicalRoundManifestChecksum)}
                  </code>
                  <code title={entry.canonicalPayloadChecksum}>
                    Payload {compactChecksum(entry.canonicalPayloadChecksum)}
                  </code>
                  {entry.roundKind === "first_send" ? (
                    <p>Preview {entry.previewId ?? "不可用"}</p>
                  ) : (
                    <ul>
                      {entry.additions.map((addition) => (
                        <li key={addition.additionId}>
                          <details>
                            <summary>
                              {SEND_ADDITION_LABEL[addition.kind]} ·{" "}
                              {compactChecksum(addition.contentChecksum)}
                            </summary>
                            <pre>{addition.content}</pre>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}

function contextLabel(
  contextMode: AgentContextMode | undefined,
  profileId: AgentContextProfileId | undefined
): string {
  if (contextMode === "standalone_chat") return "不连接项目";
  if (profileId === "engineering") return "工程文件";
  if (profileId === "creative_general") return "项目文件";
  return contextMode === "general_file" ? "项目文件" : "写作";
}

const SEND_ADDITION_LABEL = {
  assistant: "Assistant",
  tool_result: "Tool result",
  remote_result: "Remote result",
  user_control: "User input",
  jit_context: "JIT context",
  context_refresh: "Context refresh",
  recovery: "Recovery"
} as const;

function compactChecksum(checksum: string): string {
  if (checksum.length <= 20) return checksum;
  return `${checksum.slice(0, 12)}…${checksum.slice(-4)}`;
}
