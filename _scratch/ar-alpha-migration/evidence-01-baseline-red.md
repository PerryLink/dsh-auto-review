# Evidence 01 — alpha.2 钉号基线红项（temp 副本 `%TEMP%\ar-alpha2-mig` 实测原文）

- 日期：2026-09-08。方法：robocopy 真仓 → temp（/XD node_modules .git lib），仅 devDependencies
  15 个 dsh-* 钉号 `0.1.2-rc.1` → `0.1.3-alpha.2`（spine-demo 0.1.1-rc.2 不动；dependencies 15 个
  rc.1 钉号不动；peers 不动），`npx -y pnpm@11.7.0 install` 成功（无版本冲突，无需追加
  minimumReleaseAge 排除——仓内 pnpm-workspace.yaml 已有 `@deepseek-ai/*` 排除）。
- 注意：PowerShell 重写 package.json 曾引入 UTF-8 BOM 导致 prepare 脚本 JSON.parse 失败（tsdown
  SyntaxError Unexpected token ''）；用 node 无 BOM 重写后 install 全绿。此坑只影响 temp 实验流程。

## 1. typecheck 红项（7 处，3 个文件；与任务书「4 个字面量类型错」同族，实际为 7 处）

```
test/eval/runner.spec.ts(31,13): error TS2352: Conversion of type '{ version: 0; id: SessionId; createdAt: number; cwd: string; delegationDepth: number; }' to type 'SessionHeader' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Property 'isSeeded' is missing in type '{ version: 0; id: SessionId; createdAt: number; cwd: string; delegationDepth: number; }' but required in type 'SessionHeader'.
test/isolation.spec.ts(48,5): error TS2322: Type '0' is not assignable to type '2'.
test/reviewer.spec.ts(33,5): error TS2322: Type '0' is not assignable to type '2'.
test/reviewer.spec.ts(79,7): error TS2322: Type '0' is not assignable to type '2'.
test/reviewer.spec.ts(123,7): error TS2322: Type '0' is not assignable to type '2'.
test/reviewer.spec.ts(336,7): error TS2322: Type '0' is not assignable to type '2'.
test/reviewer.spec.ts(359,7): error TS2322: Type '0' is not assignable to type '2'.
```

根因（evidence-00 §5.5）：alpha.2 `SESSION_FORMAT_VERSION = 2`、`SessionHeader.version` 窄化为
`typeof SESSION_FORMAT_VERSION`。src/ 在 alpha.2 下 typecheck 干净（双线 fold 已落地）。

## 2. 行为测试红项（11 个，2 个文件；总数 278 = 267 过 + 11 红）

```
 FAIL  test/isolation.spec.ts > reviewer context firewall > strips workspace instructions, the runtime-context snapshot, and third-party injections from the first step
AssertionError: expected undefined to be defined   (isolation.spec.ts:138 → prompt 未定义)
 FAIL  test/isolation.spec.ts > reviewer context firewall > keeps filtering later steps, whose claimed messages are tool results and not the prompt
AssertionError: expected undefined to be defined   (同上)
 FAIL  test/isolation.spec.ts > reviewer context firewall > leaves a sibling subagent's step untouched while a review is pending
AssertionError: expected [] to deeply equal [ …(2) ]   (isolation.spec.ts:189 → seen 为空)
 FAIL  test/isolation.spec.ts > reviewer context firewall > leaves a non-reviewer step untouched
Error: session header version must be 2, got 0
 ❯ validateSessionHeader @deepseek-ai/dsh-session/lib/index.js:724
 ❯ snapshotSessionHeader …:755 → new Session …:1001 → Function.create …:968
 ❯ childAgent test/isolation.spec.ts:47
 FAIL  test/reviewer.spec.ts > reviewer prompt > names the tool, the reason, the workspace, and the risk rules
Error: session header version must be 2, got 0  （Session.create reviewer.spec.ts:78）
 FAIL  test/reviewer.spec.ts > reviewer prompt > truncates the request reason to the shared budget
Error: session header version must be 2, got 0  （reviewer.spec.ts:122）
 FAIL  test/reviewer.spec.ts > Phase B prompt sections > includes the ruling policy text, the override context, and field-scoped risk rules
Error: session header version must be 2, got 0  （reviewer.spec.ts:335）
 FAIL  test/reviewer.spec.ts > Phase B prompt sections > omits the override and policy sections when not configured
Error: session header version must be 2, got 0  （reviewer.spec.ts:358）
 FAIL  test/reviewer.spec.ts > compact transcript context > collects user/agent/tool lines bounded by the budget
Error: session header version must be 2, got 0  （sessionWithEvents reviewer.spec.ts:32）
 FAIL  test/reviewer.spec.ts > compact transcript context > is disabled with turns 0 and truncates to the character cap
Error: session header version must be 2, got 0  （sessionWithEvents reviewer.spec.ts:32）
 FAIL  test/reviewer.spec.ts > compact transcript context > spends the character budget on the most recent lines, not the oldest
Error: session header version must be 2, got 0  （sessionWithEvents reviewer.spec.ts:32）
```

根因：全部 11 红 = 同一根因链——夹具 `Session.create(..., { version: 0 })` 被 alpha.2
`validateSessionHeader` 拒绝（"version must be 2, got 0"）；isolation 的 3 个 prompt/seen 空断言是该
header 抛错在 onStart 链上的次生表现（childAgent 抛 → prompt 未捕获）。

## 3. 修复清单 → 逐条对应

| # | 红项 | 修复 | 落点 |
|---|---|---|---|
| 1 | 7 处类型错 + 11 行为红 | 夹具 header 版本改双线常量：`version: SESSION_FORMAT_VERSION`（rc.1=0 / alpha.2=2，两线同名导出）；runner.spec 假会话 header 补 `isSeeded: false` | test/reviewer.spec.ts ×5、test/isolation.spec.ts ×1、test/eval/runner.spec.ts ×1 |
| 2 | 修复后 alpha.2 门禁 | `typecheck` exit 0；`vitest run` **278/278 passed (24 files)**（原文见 evidence-02） | temp 副本实测 |

- 任务书说「reviewer.spec 4 个字面量类型错」：本会话实测 reviewer.spec 为 5 处、外加
  isolation.spec 1 处与 runner.spec 1 处（共 7 处）。计数差异 = 上轮 temp 副本代码状态不同
  （isolation/runner 的 fixture 也可能当时未列入），本会话以实测 7 处为准，全部修复。
