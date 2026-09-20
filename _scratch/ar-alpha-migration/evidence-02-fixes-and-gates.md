# Evidence 02 — 修复落地 + 双线门禁证据（2026-09-08 实测）

## 1. 修复清单（红项 → 修复 → 落点）

| 红项（evidence-01） | 修复 | 落点 |
|---|---|---|
| 7 处类型错（reviewer.spec ×5 / isolation.spec ×1 / runner.spec ×1：`Type '0' is not assignable to type '2'`、TS2352 header cast） | 夹具 header 版本改用双线同名导出常量 `SESSION_FORMAT_VERSION`（rc.1=0 / alpha.2=2）；runner.spec 假会话 header 补 `isSeeded: false` | test/reviewer.spec.ts、test/isolation.spec.ts、test/eval/runner.spec.ts |
| 11 个行为测试红（isolation ×4 / reviewer ×7，全部 "session header version must be 2, got 0" 或其次生 prompt/seen 空断言） | 同一修复（header 版本），无一行为代码改动 | 同上 |
| alpha.2 宿主审计归类 | `isUnmarkedHostVersion` 兜底规则已覆盖（`0.1.3-alpha.2` 命中 `minor>=2` 行规则）；新增测试条目 `'0.1.3-alpha.2'` + audit.ts 注释/文档点名 alpha.2（tarball 实测：append 无 ignorable 写入路径、autoReview/* 不在 KNOWN 集 → 双线 fail-closed） | test/audit.spec.ts、src/audit.ts |
| STAY_BEHIND_ALPHA 豁免 | 整体移除（连同注释），check-host-versions 自然覆盖 alpha 线 | scripts/check-host-versions.mjs |
| dshWorkshop 兼容线 | `["0.1.2-rc.1", "0.1.3-alpha.2"]` | package.json |
| 五语 README 宿主行 + 审计 bullet | 双线表述（dev 钉 0.1.3-alpha.2 / 运行时依赖 0.1.2-rc.1 / peers 不变）；审计 bullet 增 0.1.3-alpha.2 为 non-stamping | README.md/.zh/.es/.pt/.hi |
| CHANGELOG | 顶部新增 `## [Unreleased]`（Changed ×6） | CHANGELOG.md |
| pnpm-workspace.yaml 注释 | 陈旧注释（"dev pins run 0.1.2-alpha.2 / deps 0.1.1-rc.2"）改为现状（dev 0.1.3-alpha.2 / deps 0.1.2-rc.1 / spine-demo 冻结子图 ^0.1.2-alpha.2 被 overrides 钉住）；overrides 本体保留（实测：移除后解析不变，但保留可防 spine 子图浮动到后续 0.1.2-alpha；实验脚本 `strip-overrides.mjs` 留存） | pnpm-workspace.yaml |

## 2. 门禁证据（全部真实执行输出）

### 2a. alpha.2 钉号 temp 副本（`%TEMP%\ar-alpha2-mig`，修复前基线 → 修复后）
- 修复前：typecheck 7 错（原文见 evidence-01）；vitest **11 failed | 267 passed (278)**（原文见 evidence-01）。
- 修复后：typecheck exit 0；vitest：
  ```
   Test Files  24 passed (24)
        Tests  278 passed (278)
  ```
- 其余门禁（修复后同源）：lint 0 errors、build ✓、verify:self-contained ✓、check:readmes ✓、pack ✓。

### 2b. rc.1 钉号 temp 副本（`%TEMP%\ar-rc1-mig`，同一修复源码 + rc.1 钉号 + 旧脚本含 stay-behind）——双线回归
全链 8 步 exit 0：
- typecheck 0；vitest **24 passed (24) / 278 passed (278)**
- lint：`Found 6 warnings and 0 errors`（6 条警告均为迁移前既存）
- build ✓（tsdown，lib/types + index/invariant/client）
- verify:self-contained：`self-contained: all dependency specs resolve from the registry`
- check:readmes：`all 5 READMEs share 21 sections, the install command, and 23 config keys`
- check-host-versions：`peers cover the newest rc line (0.1.2-rc.1)` + `newest alpha 0.1.3-alpha.2 is on the documented stay-behind list; skipping`（rc.1 钉号下按设计 warn 通过）
- pack：`dsh-auto-review-0.10.6.tgz` ✓

### 2c. alpha.2 钉号最终 temp 副本（`%TEMP%\ar-alpha2-mig-final`，最终源码 + alpha.2 钉号 + 豁免已移除）
全链 8 步 exit 0：
- install ✓（pnpm 11.7.0，`Done in 2.6s`，无冲突、无新增 overrides）
- typecheck 0；vitest **24 passed (24) / 278 passed (278)**
- lint：`Found 6 warnings and 0 errors`
- build ✓；verify:self-contained ✓；check:readmes ✓（21 sections / 23 keys）
- check-host-versions：`peers cover the newest rc line (0.1.2-rc.1)` + **`dev pins cover the newest alpha line (0.1.3-alpha.2)`**
- pack ✓

### 2d. 真仓（最终落盘状态，alpha.2 钉号）
见 tracker §一百二十八（真仓终跑原文）。要点：8 步全 exit 0；test 278/278；
check-host-versions 输出 `dev pins cover the newest alpha line (0.1.3-alpha.2)`；
`pnpm list --depth 0` 实测 dev 线全 `0.1.3-alpha.2`、deps 线全 `0.1.2-rc.1`（两线共存）。

## 3. 双线运行时兼容性设计（保留并验证）
- `src/eval/trace.ts`：`(event.type as string) === 'assistant/chunk'` 宽松 fold 0.1.2 计时 +
  `assistant/message` 的 `data.stream`（time0/dt）折 0.1.3 计时；attempt 无计时（trace.spec +2 用例
  6100/6325 已在 278 内，两线均绿）。
- `src/eval/runner.ts`：顶部 `await import('@deepseek-ai/dsh-session')` 特性探测 `packChunkRuns`，
  undefined 回退 raw events。
- `src/audit.ts`：`isUnmarkedHostVersion` 双线 fail-closed（alpha.2 与 rc.1 同为 non-stamping）。
- 测试夹具经 `SESSION_FORMAT_VERSION` 常量在两线间切换（rc.1=0 / alpha.2=2）。

## 4. 决策记录
- dependencies 15 个 rc.1 钉号**不动**（实测 alpha dev + rc deps 共存 install 绿，无冲突，无需同迁）。
- peers `>=0.1.2-rc.1 <0.2.0` 不动（任务红线）。
- spine-demo 0.1.1-rc.2 不动；pnpm-workspace overrides 保留（钉 spine 子图 ^0.1.2-alpha.2 → 0.1.2-alpha.2，
  防浮动；实测移除后解析不变，但保留更安全）。
- `projection.spec.ts:132` 的 `{ version: 0 } as never` 为纯 fold 夹具（两线运行时均过），未改动。
