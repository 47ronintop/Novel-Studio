import type { AgentConversationViewProps } from "./workspace-shell-types.js";

export function AgentConversationInspector({
  view
}: {
  readonly view: AgentConversationViewProps;
}) {
  const run = view.agentRun;
  const composer = view.composer;
  return (
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
        <dd>{composer?.operationMode === "execution" ? "执行" : "规划"}</dd>
      </div>
      <div>
        <dt>上下文</dt>
        <dd>{composer?.contextMode === "general_file" ? "通用文件" : "写作"}</dd>
      </div>
      <div>
        <dt>写入策略</dt>
        <dd>{composer?.writePolicy === "user_preapproved_run" ? "本次运行预授权" : "写入前确认"}</dd>
      </div>
    </dl>
  );
}
