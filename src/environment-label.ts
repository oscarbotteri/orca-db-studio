// The environment label's shared rules, for the worker, the panel and the query document. C5
import type { ConnectionEntry, Environment, Tone } from './protocol'

export const ENVIRONMENTS: Environment[] = ['local', 'dev', 'staging', 'prod']

export const TONES: Tone[] = ['neutral', 'accent', 'success', 'warning', 'danger']

/** The tone an environment starts on when the person picks it in the form. */
export const DEFAULT_TONE: Record<Environment, Tone> = {
  local: 'success',
  dev: 'accent',
  staging: 'warning',
  prod: 'danger',
}

/** What the panel shows under a connection's name: the label first, then where it points. */
export function panelDescription(entry: ConnectionEntry): string {
  if (entry.origin === 'worktree') return `.env · ${entry.detail}`
  return entry.label ? `${entry.label.environment} · ${entry.detail}` : entry.detail
}

/** One option of the "Choose connection" select. */
export function optionText(entry: ConnectionEntry): string {
  const label = entry.label ? ` [${entry.label.environment}]` : ''
  return `${entry.name}${label} (${entry.detail})`
}
