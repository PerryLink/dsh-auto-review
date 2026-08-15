/**
 * User-facing command strings for `dsh-auto-review` in the supported
 * languages. The table is a pure function of the resolved `language` config;
 * the English strings are the source of truth, the Chinese twin mirrors
 * them. Reviewer-prompt content is NOT here (it is config-provided
 * guidance/policy text, not command UI).
 * @module dsh-auto-review/messages
 */

/** Supported UI languages for the `/auto-review` command output. */
export type UiLanguage = 'en' | 'zh'

/** All command strings of one language. */
export interface Messages {
  readonly usage: string
  readonly description: string
  readonly statusLine: (enabled: boolean) => string
  readonly verdictsLine: (used: number, max: number) => string
  readonly failuresLine: (used: number, max: number) => string
  readonly circuitLine: (kind: string, count: number, action: string) => string
  readonly allTimeLine: (allows: number, denies: number, fallbacks: number, rejections: number, avg: number) => string
  readonly recentLine: (labels: string) => string
  readonly unknownArg: (arg: string) => string
  readonly already: (state: string) => string
  readonly switchedNotice: (enabled: boolean) => string
  readonly switchedResult: (state: string) => string
  readonly approveResult: (toolName: string, reviewId: string, minutes: number) => string
  readonly approveNone: (index: number, count: number) => string
  readonly approveInvalid: (arg: string) => string
  readonly circuitNotice: (kind: string, count: number) => string
}

const EN: Messages = {
  usage: 'Usage: /auto-review on|off|status|approve [n]',
  description: 'enable or disable second-model AI auto-review for this session, inspect verdicts, or approve one retry',
  statusLine: enabled => `Auto-review is ${enabled ? 'ON' : 'OFF'} for this session.`,
  verdictsLine: (used, max) => `AI verdicts this turn: ${used}/${max}`,
  failuresLine: (used, max) => `Reviewer failures this turn: ${used}/${max}`,
  circuitLine: (kind, count, action) => `Rejection circuit breaker tripped (${kind}: ${count} denials); later requests in this turn follow "${action}".`,
  allTimeLine: (allows, denies, fallbacks, rejections, avg) => `All-time: ${allows} allows, ${denies} denies, ${fallbacks} fallbacks, ${rejections} never rejects (avg ${avg} ms per verdict).`,
  recentLine: labels => `Recent verdicts: ${labels}`,
  unknownArg: arg => `Unknown /auto-review argument "${arg}". Usage: /auto-review on|off|status|approve [n]`,
  already: state => `Auto-review is already ${state} for this session.`,
  switchedNotice: enabled => `AI auto-review was switched ${enabled ? 'ON' : 'OFF'} for this session (changed by the user).`,
  switchedResult: state => `Auto-review ${state} for this session.`,
  approveResult: (toolName, reviewId, minutes) => [
    `Authorized ONE retry of the denied ${toolName} action (review ${reviewId}).`,
    `The next ${toolName} review within ${minutes} minutes carries this authorization as reviewer context — the reviewer still decides.`,
  ].join('\n'),
  approveNone: (index, count) => `No recent denial #${index} in this session (${count} recorded).`,
  approveInvalid: arg => `Invalid /auto-review approve index "${arg}". Usage: /auto-review approve [n]`,
  circuitNotice: (kind, count) => `The AI auto-review rejection circuit breaker tripped (${kind}: ${count} denials). `
    + 'This turn is aborted because the agent kept proposing blocked actions. '
    + 'Adjust the sandbox boundary or the review policy, then continue.',
}

const ZH: Messages = {
  usage: '用法：/auto-review on|off|status|approve [n]',
  description: '为本会话启用或禁用第二模型 AI 自动审查、查看裁决统计，或批准一次重试',
  statusLine: enabled => `本会话的自动审查已${enabled ? '开启' : '关闭'}。`,
  verdictsLine: (used, max) => `本回合 AI 裁决数：${used}/${max}`,
  failuresLine: (used, max) => `本回合审查失败数：${used}/${max}`,
  circuitLine: (kind, count, action) => `拒绝熔断器已触发（${kind}：${count} 次拒绝）；本回合后续请求按 "${action}" 处理。`,
  allTimeLine: (allows, denies, fallbacks, rejections, avg) => `累计：${allows} 次放行，${denies} 次拒绝，${fallbacks} 次失败，${rejections} 次硬禁用拒绝（每次裁决平均 ${avg} ms）。`,
  recentLine: labels => `最近裁决：${labels}`,
  unknownArg: arg => `未知的 /auto-review 参数 "${arg}"。用法：/auto-review on|off|status|approve [n]`,
  already: state => `本会话的自动审查已处于 ${state} 状态。`,
  switchedNotice: enabled => `AI 自动审查已为本会话${enabled ? '开启' : '关闭'}（由用户更改）。`,
  switchedResult: state => `本会话的自动审查已${state}。`,
  approveResult: (toolName, reviewId, minutes) => [
    `已批准对 ${toolName} 被拒操作的一次重试（审查 ${reviewId}）。`,
    `接下来 ${minutes} 分钟内对 ${toolName} 的下一次审查将携带该授权作为审查上下文——最终仍由审查代理裁决。`,
  ].join('\n'),
  approveNone: (index, count) => `本会话没有第 ${index} 条近期拒绝记录（共 ${count} 条）。`,
  approveInvalid: arg => `无效的 /auto-review approve 序号 "${arg}"。用法：/auto-review approve [n]`,
  circuitNotice: (kind, count) => `AI 自动审查拒绝熔断器触发（${kind}：${count} 次拒绝）。`
    + '由于代理持续提出被阻止的操作，本回合已中止。'
    + '请调整沙箱边界或审查策略后继续。',
}

/** The message tables, keyed by {@link UiLanguage}. */
export const MESSAGES: Readonly<Record<UiLanguage, Messages>> = { en: EN, zh: ZH }

/**
 * Pick one language's message table.
 * @param language - the resolved UI language.
 * @returns the table (English and Chinese are the shipped languages).
 */
export function messages(language: UiLanguage): Messages {
  return MESSAGES[language]
}
