// The toolbar's name for the document's connection, and the band above it. C5, ADR 0005
import type { ConnectionEntry, Tone } from '../protocol'

export interface BadgeModel {
  text: string
  tone: Tone
  /** Whether the colored band is drawn: only a connection with an environment has one. */
  band: boolean
}

/** `undefined` while the document names no connection the registry knows. */
export function badgeModel(entry: ConnectionEntry | undefined): BadgeModel | undefined {
  if (!entry) return undefined
  if (!entry.label) return { text: entry.name, tone: 'neutral', band: false }
  return { text: `[${entry.label.environment}] ${entry.name}`, tone: entry.label.tone, band: true }
}

/**
 * Orca's theme has a variable for neutral text and for danger only, so the other tones get a
 * color per theme, each at 4.5:1 on backgrounds from white to #f0f0f0 and from black to #2b2b2b.
 * `:root` carries the light set as a default for a page with neither class.
 */
export const BADGE_STYLE = `
  html.light, :root { --tone-accent: #0b5fa5; --tone-success: #0a6b3a; --tone-warning: #8a5a00; }
  html.dark { --tone-accent: #6cb6ff; --tone-success: #8fd18f; --tone-warning: #f0c36e; }
  .tone-neutral { --tone: var(--orca-muted-foreground); }
  .tone-accent { --tone: var(--tone-accent); }
  .tone-success { --tone: var(--tone-success); }
  .tone-warning { --tone: var(--tone-warning); }
  .tone-danger { --tone: var(--orca-destructive, #d33); }
  .band { flex: none; height: 4px; background: var(--tone); }
  .badge { font-weight: 600; color: var(--tone); border: 1px solid var(--tone);
    border-radius: 4px; padding: 1px 8px; }
  .band[hidden], .badge[hidden] { display: none; }
`

export interface EnvironmentBadge {
  /** The colored strip across the top of the document. */
  band: HTMLElement
  /** The connection's name, for the toolbar. */
  badge: HTMLElement
  /** Shows the connection, or nothing when it is unknown. */
  show(entry: ConnectionEntry | undefined): void
}

export function createEnvironmentBadge(): EnvironmentBadge {
  const band = document.createElement('div')
  const badge = document.createElement('span')
  band.hidden = true
  badge.hidden = true
  return {
    band,
    badge,
    show(entry) {
      const model = badgeModel(entry)
      badge.hidden = model === undefined
      band.hidden = !model?.band
      if (!model) return
      badge.textContent = model.text
      badge.className = `badge tone-${model.tone}`
      band.className = `band tone-${model.tone}`
    },
  }
}
