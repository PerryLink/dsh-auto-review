# dsh-auto-review 0.1.0 — 发布说明

## 一句话

`dsh-auto-review` 是 DeepSeek Harness 的**第二模型自动审批**插件：在官方 `approval/request` answerer 链上挂接只读审查子代理，对越界操作在超时内给出结构化 allow/deny 裁决与理由，人类可配置哪些工具/风险走 AI 审批、哪些仍强制人类审批；默认 fail closed，全链路可从会话日志重建。

## 边界说明：与 ACP one-shot 决策的关系

| | ACP automation bridge（`packages/acp/acp`） | dsh-auto-review |
|---|---|---|
| 挂接点 | `approval/request` answerer，但只为其**自有的 ACP agent** 应答 | `approval/request` answerer，为**任意会话**按工具/风险策略应答 |
| 决策者 | ACP 客户端的 `requestPermission` 一次性选择（机器策略通道） | 一次性**审查子代理**（只读工具面 + 结构化裁决 schema） |
| 授权语义 | one-shot，绝不从客户端响应推断持久授权 | one-shot，绝不产生持久授权；`never`/策略语义完全独立 |
| 失败语义 | 无应答 → fail-closed `unavailable` | 审查失败 → `fallbackPolicy`（默认 `rejected`） |
| 审计 | 服务自动记录的 `approval/asked` + `approval/decided` | 同左 + `autoReview/verdict`（reviewer 身份/裁决/理由/耗时/风险等级）+ invariant 校验 |

两者可以共存：ACP bridge 先于（或后于）本插件注册时，各自只应答自己拥有的请求，其余 `next()`；`never` policy 在服务内强制，两个 answerer 都无法绕过。

## 与 Andy8647/dsh-auto-approval 的差异化

调研结论：`dsh-auto-approval` 已实现 AI 判断（L1 classifier 二态 allow/deny），挂在 `tools/pre-execute` waterfall、全托管不转人工、审计走自有文件日志。本插件因此采用差异化命名与路线：answerer 链挂接（不短路人类）、只读第二模型结构化裁决、拒绝理由回喂模型、会话日志级审计（模型可见 ⟺ 已记录 + invariant）。详见 README「Related work」。

## 验收对照

- [x] 默认配置下，命中白名单工具（bash/write/edit）的越界审批无需人类操作，reviewer 在 `reviewerTimeoutMs`（默认 60s）内给出裁决与理由
- [x] 未命中白名单的请求 `next()` 委托给人类 answerer，人类审批流程不被短路
- [x] reviewer 自身引发的审批不递归（会话身份识别 + `maxDepth: 0` + 只读 toolFilter）
- [x] reviewer 崩溃/超时/schema 错误按 `fallbackPolicy` 处理，默认拒绝（fail closed）
- [x] 每个 AI 裁决都能从会话日志重建（`approval/asked` → `autoReview/verdict` → `approval/decided` 齐全，invariant 强制校验）
- [x] `/auto-review on|off|status` 生效且状态跨会话恢复（durable `autoReview/state` 事件，last-wins fold）
- [x] `npm test` 通过（61 测试 / 6 套件）；干净 profile 安装后 `dsh --dump-config` 无 FAILED

## 安全红线落实情况

- S1 fail closed：所有异常路径走 `fallbackPolicy`，默认 `rejected`；`allow-readonly` 显式标注为危险选项。
- S2 不绕过 `never` policy（服务内强制）；不改核心审批服务、不改 agent-loop（纯插件挂接文档化扩展点）。
- S3 审查子代理只读工具面（`toolFilter` 白名单 + `maxDepth: 0`），其会话日志落盘可审计。
- S4 不执行被审参数；敏感键值脱敏后仅供审查参考（键名级脱敏，局限已在 README 声明）。

## 兼容性

- 目标运行时：dsh `0.1.0-rc.6` web profile（`@deepseek-ai/dsh-*` peer 精确锁定 `0.1.0-rc.6`，`@deepseek-ai/cordis ^4.0.1`）。
- 纯 cordis 插件，无 browser 侧；不使用已移除的 repository-plugin 机制，安装走 bundle patch。
- git 源安装需自包含 `prepare`（构建工具在 `dependencies` 中）+ 用户侧 `allowBuilds`；npm/tarball 免构建许可。
- invariant 伴生（`dsh-auto-review/invariant`）随包发布但默认不挂载：它等待 `invariants` 服务（spine 组合提供，普通 web profile 不提供）；在 headless/ACP 等组合中把 patch 内注释行取消注释加入 profile 层即可。

## 测试覆盖

`test/`：answerer 单测（接单/委托/fail-closed/防递归/预算/审计链）、mock subagent 评审（toolFilter/outputSchema/prompt/脱敏/超时/中止）、配置解析（默认值/风险规则编译 fail-loud/schema 拒绝非法值）、命令（on/off/status/跨恢复）、invariant（4 个 session fixture：合法 deny 链、孤儿标记、孤儿 asked、混合字段 + 增量校验）。`fixtures/` 共 6 个（4 会话日志 + 2 配置示例）。

## 已知局限

见 README「Known limitations」：LLM 路由依赖、`reviewerTools` 必须是真实全局工具、风险规则只匹配 reason、键名级脱敏、`typescript`+`tsdown` 为生产依赖（git prepare 所需）。

## 演示

GIF 演示（越界请求 → AI 裁决放行/拒绝 → 审计面板可见理由）见 `docs/demo-auto-review.gif`（随仓库分发）。
