/**
 * Copy dictionaries for the auto-review session-header panel (en/zh — the
 * harness locale registry accepts these two UI language codes today).
 * @module dsh-auto-review/client/locales
 */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  label: 'AI 审查',
  title: 'AI 自动审查',
  stateOn: '已开启',
  stateOff: '已关闭',
  verdicts: '本回合 AI 裁决',
  failures: '本回合失败',
  allTime: '累计',
  allows: '放行',
  denies: '拒绝',
  fallbacks: '失败',
  avg: '平均耗时',
  circuit: '拒绝熔断器已触发',
  circuitDetail: '触发类型：{kind}，计数 {count}，动作 {action}',
  empty: '本会话暂无 AI 审查裁决。',
  recent: '最近裁决',
  denyList: '可批准的重试',
  approve: '批准重试',
  approveResult: '已授权：{text}',
  approveFailed: '批准失败：{text}',
  unavailable: '审查面板不可用（宿主未提供会话投影能力）。',
  decisionAllow: '放行',
  decisionDeny: '拒绝',
  fallbackLabel: '失败（{kind}）',
  escalationLabel: '风险策略升级',
  riskLow: '低风险',
  riskMedium: '中风险',
  riskHigh: '高风险',
  ms: 'ms',
} satisfies Record<string, string>

/** Auto-review panel locale key union. */
export type ReviewPanelLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en: Record<ReviewPanelLocaleKey, string> = {
  label: 'AI Review',
  title: 'AI Auto-Review',
  stateOn: 'ON',
  stateOff: 'OFF',
  verdicts: 'AI verdicts this turn',
  failures: 'Failures this turn',
  allTime: 'All-time',
  allows: 'allows',
  denies: 'denies',
  fallbacks: 'fallbacks',
  avg: 'avg',
  circuit: 'Rejection circuit breaker tripped',
  circuitDetail: '{kind}: {count} denials, action {action}',
  empty: 'No AI review verdicts in this session yet.',
  recent: 'Recent verdicts',
  denyList: 'Approvable retries',
  approve: 'Approve retry',
  approveResult: 'Authorized: {text}',
  approveFailed: 'Approve failed: {text}',
  unavailable: 'The review panel is unavailable (the host does not provide the session-projection capability).',
  decisionAllow: 'allow',
  decisionDeny: 'deny',
  fallbackLabel: 'fallback ({kind})',
  escalationLabel: 'risk-policy escalation',
  riskLow: 'low risk',
  riskMedium: 'medium risk',
  riskHigh: 'high risk',
  ms: 'ms',
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'autoReviewPanel'
