export function warningRuntimeNotice(event: {
  readonly code: string;
  readonly message: string;
}): string {
  if (event.code === "LLM_REASONING_EFFORT_IGNORED") {
    return "该模型/端点不支持推理强度调节，已移除推理参数并重试。";
  }
  return event.message;
}
