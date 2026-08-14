/**
 * Scoped stylesheet for the review panel. Standalone bundles cannot use the
 * in-repo CSS-module pipeline, so the panel injects one `<style>` element
 * whose selectors are all scoped under `[data-dsh-auto-review]`.
 * @module dsh-auto-review/client/styles
 */

const STYLE_ID = 'dsh-auto-review-panel-styles'

const CSS = `
[data-dsh-auto-review] {
  --ar-allow: var(--dsw-color-success, #16a34a);
  --ar-deny: var(--dsw-color-danger, #dc2626);
  --ar-fallback: var(--dsw-color-warning, #d97706);
  --ar-escalation: var(--dsw-color-warning, #d97706);
  --ar-border: var(--dsw-color-border, rgba(128, 128, 128, 0.3));
  --ar-bg: var(--dsw-color-surface, #ffffff);
  --ar-fg: var(--dsw-color-text, #1f2328);
  --ar-muted: var(--dsw-color-text-muted, #6b7280);
  font-family: inherit;
  color: var(--ar-fg);
}
[data-dsh-auto-review-panel] {
  position: absolute;
  z-index: 40;
  min-width: 320px;
  max-width: 420px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--ar-bg);
  border: 1px solid var(--ar-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
}
[data-dsh-auto-review-button] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--ar-border);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--ar-fg);
}
[data-dsh-auto-review-button]:hover {
  background: rgba(128, 128, 128, 0.12);
}
[data-dsh-auto-review-section] {
  margin: 8px 0;
  border-top: 1px solid var(--ar-border);
  padding-top: 8px;
}
[data-dsh-auto-review-title] {
  font-weight: 600;
  margin-bottom: 6px;
}
[data-dsh-auto-review-row] {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  align-items: baseline;
}
[data-dsh-auto-review-muted] {
  color: var(--ar-muted);
}
[data-dsh-auto-review-verdict] {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--ar-border);
}
[data-dsh-auto-review-tone-allow] { color: var(--ar-allow); }
[data-dsh-auto-review-tone-deny] { color: var(--ar-deny); }
[data-dsh-auto-review-tone-fallback] { color: var(--ar-fallback); }
[data-dsh-auto-review-tone-escalation] { color: var(--ar-escalation); }
[data-dsh-auto-review-approve] {
  cursor: pointer;
  border: 1px solid var(--ar-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ar-fg);
  padding: 1px 6px;
  font-size: 11px;
}
[data-dsh-auto-review-approve]:hover {
  background: rgba(128, 128, 128, 0.12);
}
[data-dsh-auto-review-circuit] {
  color: var(--ar-deny);
  font-weight: 600;
}
`

/** Install the scoped stylesheet once per plugin fiber. */
export function installPanelStyles(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => undefined
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return () => {
    element.remove()
  }
}
