# Fixtures 规则

Fixtures 只用于测试和本地验证，不代表真实用户项目。

## 基本规则

- 不得放入真实 API key、token、cookie 或个人隐私数据。
- LLM 相关 fixtures 必须使用 mock 或脱敏 provider payload。
- 项目 fixtures 应保持足够小，除非测试明确需要大型 fixture。
- 大型 fixture 必须由脚本生成，避免手工维护超大文本。
- Invalid fixtures 必须稳定失败，并说明失败意图。

## 维护要求

- 修改 schema 时同步更新 valid/invalid fixtures。
- 修改 Repository、Context、Agent 或 LLM contract 时补充对应 fixture。
- Fixture 文件可以包含英文技术字段名；说明性文字优先使用中文。
