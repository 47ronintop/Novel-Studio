import React from "react";

interface AuthorizedTask {
  taskId: string;
  displayName: string;
  cwd: string;
  fileProfile: string;
  networkMode: "none";
  resourceQuota: {
    maxWallClockMs: number;
    maxMemoryBytes: number;
  };
  catalogRevision: string;
  authorizedAt: string;
}

interface AgentTaskCatalogPanelProps {
  readonly tasks: readonly AuthorizedTask[];
  readonly onRevoke?: (taskId: string) => void;
}

/**
 * AgentTaskCatalogPanel — shows authorized tasks with metadata.
 * Displays user-friendly name + metadata only. NO raw command display.
 */
export function AgentTaskCatalogPanel({ tasks, onRevoke }: AgentTaskCatalogPanelProps) {
  if (tasks.length === 0) {
    return (
      <div className="agent-task-catalog-panel agent-task-catalog-panel--empty">
        <p>暂无已授权的项目任务。</p>
      </div>
    );
  }

  return (
    <div className="agent-task-catalog-panel">
      <h3 className="agent-task-catalog-panel__title">已授权任务</h3>
      <ul className="agent-task-catalog-panel__list" role="list">
        {tasks.map((task) => (
          <li key={task.taskId} className="agent-task-catalog-panel__item">
            <div className="agent-task-catalog-panel__item-header">
              <span className="agent-task-catalog-panel__item-name">{task.displayName}</span>
              {onRevoke !== undefined && (
                <button
                  type="button"
                  className="agent-task-catalog-panel__revoke-btn"
                  onClick={() => onRevoke(task.taskId)}
                  aria-label={`撤销授权：${task.displayName}`}
                >
                  撤销
                </button>
              )}
            </div>
            <dl className="agent-task-catalog-panel__meta">
              <dt>工作目录</dt>
              <dd>{task.cwd || "."}</dd>
              <dt>文件访问</dt>
              <dd>{task.fileProfile === "workspace_read_only" ? "只读工作区" : "暂存输出"}</dd>
              <dt>网络</dt>
              <dd>{task.networkMode}</dd>
              <dt>最大运行时间</dt>
              <dd>{Math.round(task.resourceQuota.maxWallClockMs / 1000)} 秒</dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
