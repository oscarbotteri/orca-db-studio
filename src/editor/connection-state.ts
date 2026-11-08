// Whether a query document must offer the connection chooser, and what it tells the person. Q1
import type { ConnectionEntry, ConnectionList } from '../protocol'

export interface ChooserState {
  needsChoice: boolean
  notice: string | undefined
}

/** Every connection a document may name: SQLite files and saved servers alike. */
export function connectionEntries(list: ConnectionList): ConnectionEntry[] {
  return [...list.sqliteFiles, ...list.servers]
}

/**
 * `entries` is undefined when the registry could not be listed: the document's own line then
 * stands until `connection.info` says otherwise.
 */
export function chooserState(
  ref: string | undefined,
  entries: ConnectionEntry[] | undefined,
  readOnly: boolean,
): ChooserState {
  const stale = ref !== undefined && entries !== undefined && !entries.some((e) => e.ref === ref)
  const needsChoice = ref === undefined || stale
  let notice: string | undefined
  if (!needsChoice) notice = undefined
  else if (readOnly) notice = 'This file is read-only, so a connection cannot be written to it.'
  else if (stale) notice = `The connection ${ref} no longer exists. Choose another.`
  else if (entries?.length === 0) notice = 'No connections yet. Add one in the DB Studio panel.'
  return { needsChoice, notice }
}
