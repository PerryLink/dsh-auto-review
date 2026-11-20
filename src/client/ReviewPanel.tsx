/**
 * The session-header review panel: a button in the conversation header that
 * opens a popover with this session's auto-review state — the on/off switch,
 * budgets, cumulative statistics (including hard-disable rejections and
 * cache hits), the circuit trip, recent verdicts, and one-shot approve
 * buttons for recent denials. Data arrives through the `autoReview` session
 * projection; switches and approves execute the `/auto-review` command
 * through the commands Remote.
 *
 * The popover is portalled onto `document.body` and positioned `fixed` from
 * the button's `getBoundingClientRect()`. Rendering it inline made it a
 * descendant of the conversation header's title cluster, whose CSS sets
 * `overflow: clip` plus a 36px height for long-title truncation — the panel
 * was painted but clipped away, leaving only a thin sliver visible.
 * @module dsh-auto-review/client/ReviewPanel
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AutoReviewProjection } from '../projection-types.ts'
import { presentVerdict } from './present.ts'
import { NS } from './locales.ts'

/** Panel width in px; fixed so the position is known before the first paint. Keep in sync with `styles.ts`. */
const PANEL_WIDTH = 360
/** Vertical gap between the button and the panel. */
const PANEL_GAP = 6
/** Minimum distance kept between the panel and the viewport edges. */
const VIEWPORT_MARGIN = 8
/** Assumed panel height when deciding whether to flip above the button. */
const PANEL_ESTIMATED_HEIGHT = 320

/** Viewport-space position of the portalled panel. */
interface PanelPosition {
  readonly top: number
  readonly left: number
}

/** Registration-side injected face: the approve action for one recent denial. */
export interface ReviewPanelInjected {
  /** Approve the n-th most recent denial (1 = most recent); resolves with the command result text. */
  approve: (n: number) => Promise<string>
  /** Switch the session's auto-review on/off (`/auto-review on|off`); resolves with the command result text. */
  setEnabled: (enabled: boolean) => Promise<string>
}

/** Full component props assembled by the session-header slot renderer. */
export type ReviewPanelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<ReviewPanelInjected>
  // The projection seat is structural: the host removed the client-runtime
  // merge that used to type it, and the seat differs across harness lines
  // (alpha.2 serves useConversation/useInput standard props), so the panel
  // reads it as an optional seat and casts at the single call site.
  & { readonly useProjection?: unknown }

/** Compact verdict-row badge label for the panel. */
function verdictBadge(
  value: AutoReviewProjection | undefined,
  t: ReviewPanelProps['t'],
): ReactNode {
  if (value === undefined) return t('unavailable')
  const fallback = (kind: string): string => t('fallbackLabel').replace('{kind}', kind)
  const labels = {
    allow: t('decisionAllow'),
    deny: t('decisionDeny'),
    fallback,
    escalation: t('escalationLabel'),
  }
  return value.recent.map(verdict => presentVerdict(verdict, labels)).map(row => (
    <div key={row.reviewId} data-dsh-auto-review-verdict>
      <span data-dsh-auto-review-muted>{row.toolName}</span>
      <span data-dsh-auto-review={`tone-${row.tone}`}>{row.label}</span>
      <span data-dsh-auto-review-muted>{row.detail}</span>
    </div>
  ))
}

/**
 * Render the review panel action.
 * @param props - framework kit (sessionId, useProjection), locale, and the approve face.
 * @returns the header button with its portalled popover.
 */
export function ReviewPanel({ useProjection, approve, setEnabled, t }: ReviewPanelProps): ReactNode {
  const readProjection = useProjection as unknown as (unit: 'autoReview') => AutoReviewProjection | undefined
  const value = readProjection('autoReview')
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const anchor = useRef<HTMLDivElement | null>(null)
  const toggle = (): void => setOpen(previous => !previous)
  const runApprove = async (n: number): Promise<void> => {
    try {
      const text = await approve(n)
      setNotice(t('approveResult').replace('{text}', text))
    } catch (error: unknown) {
      setNotice(t('approveFailed').replace('{text}', error instanceof Error ? error.message : String(error)))
    }
  }
  const runSwitch = async (enabled: boolean): Promise<void> => {
    try {
      const text = await setEnabled(enabled)
      setNotice(t('switchedResult').replace('{text}', text))
    } catch (error: unknown) {
      setNotice(t('switchFailed').replace('{text}', error instanceof Error ? error.message : String(error)))
    }
  }
  // Track the button while the popover is open: the header moves with the
  // conversation scroll and the viewport, and the panel is out of flow.
  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = (): void => {
      const button = anchor.current?.querySelector('[data-dsh-auto-review-button]')
      if (!(button instanceof HTMLElement)) return
      const rect = button.getBoundingClientRect()
      const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - width)
      const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.right - width), maxLeft)
      let top = rect.bottom + PANEL_GAP
      if (top + PANEL_ESTIMATED_HEIGHT > window.innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, rect.top - PANEL_ESTIMATED_HEIGHT - PANEL_GAP)
      }
      setPosition(previous => (
        previous !== null && previous.top === top && previous.left === left ? previous : { top, left }
      ))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  return (
    <div data-dsh-auto-review ref={anchor}>
      <button type="button" data-dsh-auto-review-button onClick={toggle}>
        {t('label')}
      </button>
      {open && position !== null && createPortal(
        <div data-dsh-auto-review-panel style={{ top: position.top, left: position.left }}>
          <div data-dsh-auto-review-title>{t('title')}</div>
          {value === undefined
            ? <div data-dsh-auto-review-muted>{t('unavailable')}</div>
            : (
              <div>
                <div data-dsh-auto-review-row>
                  <span>{t('state')}</span>
                  <span>{value.enabled ? t('stateOn') : t('stateOff')}</span>
                </div>
                <div data-dsh-auto-review-row>
                  <span>{t('enable')} / {t('disable')}</span>
                  <span>
                    <button
                      type="button"
                      data-dsh-auto-review-switch
                      disabled={value.enabled}
                      onClick={() => void runSwitch(true)}
                    >
                      {t('enable')}
                    </button>
                    <button
                      type="button"
                      data-dsh-auto-review-switch
                      disabled={!value.enabled}
                      onClick={() => void runSwitch(false)}
                    >
                      {t('disable')}
                    </button>
                  </span>
                </div>
                <div data-dsh-auto-review-row>
                  <span>{t('verdicts')}</span>
                  <span>{value.verdictsUsed}</span>
                </div>
                <div data-dsh-auto-review-row>
                  <span>{t('failures')}</span>
                  <span>{value.failuresUsed}</span>
                </div>
                <div data-dsh-auto-review-row>
                  <span>{t('cacheHits')}</span>
                  <span>{value.cacheHits}</span>
                </div>
                <div data-dsh-auto-review-row>
                  <span>{t('allTime')}</span>
                  <span>
                    {value.allows} {t('allows')} · {value.denies} {t('denies')} · {value.fallbacks} {t('fallbacks')} · {value.neverRejects} {t('neverRejects')} · {t('avg')} {value.avgDurationMs} {t('ms')}
                  </span>
                </div>
                {value.circuit !== null && (
                  <div data-dsh-auto-review-circuit>
                    {t('circuit')} — {t('circuitDetail')
                      .replace('{kind}', value.circuit.trip.kind)
                      .replace('{count}', String(value.circuit.trip.count))
                      .replace('{action}', value.circuit.action)}
                  </div>
                )}
                {value.recentDenies.length > 0 && (
                  <div data-dsh-auto-review-section>
                    <div data-dsh-auto-review-title>{t('denyList')}</div>
                    {value.recentDenies.map((deny, index) => (
                      <div key={deny.reviewId} data-dsh-auto-review-row>
                        <span data-dsh-auto-review-muted>{deny.toolName}</span>
                        <button type="button" data-dsh-auto-review-approve onClick={() => void runApprove(index + 1)}>
                          {t('approve')} #{index + 1}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div data-dsh-auto-review-section>
                  <div data-dsh-auto-review-title>{t('recent')}</div>
                  {value.recent.length === 0 ? <div data-dsh-auto-review-muted>{t('empty')}</div> : verdictBadge(value, t)}
                </div>
              </div>
            )}
          {notice !== null && <div data-dsh-auto-review-muted>{notice}</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}
