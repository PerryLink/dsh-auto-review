# Evidence 00 — API 面取证：dsh-session / dsh-llm 0.1.2-rc.1 → 0.1.3-alpha.2

- 日期：2026-09-08（会话实测）
- 来源：registry.npmjs.org 直连 tarball 解包（`%TEMP%\ar-api-diff\`），`git diff --no-index` 原文另存
  `diff-session-*.txt`（本目录）。
- dist-tags 实测（`https://registry.npmjs.org/@deepseek-ai/dsh`，直连）：
  `alpha = 0.1.3-alpha.2`（2026-09-07T13:11:36Z 发布，modified 同刻）、`latest = 0.1.2-rc.1`、
  `next = 0.1.2-rc.1`。**无更新 alpha**（截至本会话）。`@deepseek-ai/dsh-session` dist-tags：
  `alpha = 0.1.3-alpha.2`、`next = 0.1.2-rc.1` ✓ 同版本存在。
- 目标版本定论：**0.1.3-alpha.2**。

## 1. dsh-session `lib/types/types.d.ts`（SessionEventMap 与事件形状）

| 项 | 0.1.2-rc.1 | 0.1.3-alpha.2 |
|---|---|---|
| `assistant/chunk` 事件 | 存在：`{turn, step, chunk: StreamChunk}` | **移除** |
| `assistant/message` | `{turn, step, message, usage?, interrupted?}` | **新增必填** `stream: AssistantStreamRecord[]`（"Exact timed model stream, compacted without joining delta boundaries"） |
| `assistant/attempt` | 无 | **新增**：`{turn, step, stream: AssistantStreamRecord[]}`（"One model attempt that committed no surface message"） |
| `session/end-seed` | `Record<string, never>` | `{ inherited?: true }` |
| `SESSION_FORMAT_VERSION` | `0` | **`2`**（v0→v1→v2 迁移包，注释指向 released-session-format-migrations 笔记） |
| `SessionHeader.version` | `readonly version: number` | `readonly version: typeof SESSION_FORMAT_VERSION`（**窄化为字面量 2** —— `Type '0' not assignable to '2'` 一类测试夹具错的来源） |
| `SurfaceIntent` | 非泛型 interface（assistant/message 允许 `sourceEventSeqs` 空数组） | **泛型** `SurfaceIntent<T>`；`T = 'assistant/message'` 时 `sourceEventSeqs?: never`（禁止引用源事件，stream 内嵌替代） |
| `RestoredSessionOptions` | `seedSource: 'persistence'` | 改 `eventState: 'detached' | 'shared-frozen'`（新导出 `SessionSeedEventState`） |
| `Session.fromRestore` | `(id, seed, header, inheritedEventCount)` | `(id, seed, header, inheritedEventCount, eventState)`（**+1 必填参数**） |
| `Session.append` | `append<T>(type, data, ...opts: T extends SurfaceEventType ? [SurfaceIntent] : [])` | 同构，仅 `SurfaceIntent<T>` 泛型化 |

## 2. dsh-session 导出/子路径

- `packChunkRuns`、`decodeStorageRecord`、`ChunkRow`、`StorageRecord` 导出 **全部移除**；
  package.json `exports["./chunk-rows"]` 子路径移除，`lib/types/chunk-rows.{d.ts,js}` 文件删除
  （alpha.2 文件树与 rc.1 唯一差异即缺这两个文件）。
- `lib/index.js` 尾部 export 名单对比（实测）：rc.1 有 `packChunkRuns, decodeStorageRecord`，
  alpha.2 无；其余符号两线一致（`Session`, `SessionStore`, `KNOWN_SESSION_EVENT_TYPES`,
  `SESSION_FORMAT_VERSION`, `foldSurface`, `isSurfaceEvent`, ...）。

## 3. 审计能力面（fail-closed 判定依据）

- `KNOWN_SESSION_EVENT_TYPES`：**两线都不含 `autoReview/*`**（rc.1 与 alpha.2 的
  known-event-types.d.ts 均 grep 0 命中）→ 持久化读路径对未标记 autoReview 事件两线 fail-closed。
- alpha.2 `Session.append` 实现（lib/index.js 1092–1125 实测）：事件组装 =
  `{type, seq, time, data, ...surfaceMetadataSnapshot}`，surface 仅取 `sourceEventSeqs`/`surfaceOp`；
  **无 ignorable 写入选项**（与 rc.1 相同）。`ignorable` 在 alpha.2 仅存在于：
  事件信封类型（`SessionEvent.ignorable?: true`）与恢复校验的 `case "ignorable": break;`
  （load 时容忍该字段）——**append 时仍无法写入**。
- 结论：alpha.2 与 0.1.2-rc.1 同属"未标记宿主"线 → `src/audit.ts` 的 fail-closed 归类需把
  alpha.2 加入既有 unmarked 版本判断；探测（首事件信封返回值）仍只对"已知支持标记的未来线"运行。

## 4. dsh-llm `AssistantStreamRecord`（alpha.2 新增 `lib/types/assistant-stream.d.ts`）

```ts
type AssistantStreamRecord =
  | { type: 'text-chunks' | 'reasoning-chunks'; time0: number; index: number; dt: readonly number[]; texts: readonly string[] }
  | { type: 'tool-call-chunks'; time0: number; index: number; dt: readonly number[]; id: ToolCallId; name?: string; args: readonly string[] }
  | { type: 'chunk'; time: number; chunk: StreamChunk }
```
- 计时重建：run 成员时间 = `time0 + Σdt[0..k-1]`；`assistantStreamFirstTokenTime(stream)` /
  `runFirstTokenTime(run)` 为官方 reader；`expandAssistantStream` 是持久化边界的校验展开路径。
- dsh-llm 文件树 alpha.2 新增 `assistant-stream.{d.ts,js}`（其余结构一致）。

## 5. 结论清单（供修复对照）

1. `assistant/chunk` 类型移除 → src/test 内一切引用须走双线 fold（trace.ts 已落地，验证全覆盖）。
2. `assistant/message` 夹具须补必填 `stream`（0.1.3 线），rc.1 线夹具无此字段（双线分支夹具）。
3. `assistant/attempt` 新增 → 评测计时 fold 需把 attempt 归为"无计时"（trace.spec 已有 +2 用例）。
4. `packChunkRuns` 移除 → runner.ts 特性探测保留（已落地），alpha.2 下回退 raw events。
5. 字面量类型错（如 `Type '0' not assignable to '2'`）= `SessionHeader.version` 窄化为 2 +
   `SESSION_FORMAT_VERSION=2`；相关测试夹具/常量需按双线分支取对应值。
6. `Session.fromRestore` +1 参数 → 测试中直接调用的夹具需适配（或改走 SessionStore.prepare）。
7. `SurfaceIntent` 泛型化 → `assistant/message` 的 `sourceEventSeqs` 在 alpha.2 被禁止。
8. 审计两线 fail-closed（alpha.2 归类为 unmarked），`autoReview/*` 仍不在 KNOWN 集。
