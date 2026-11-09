// The "Choose connection" control a query document shows until it names a connection. Q1, ADR 0003
import { optionText } from '../environment-label'
import type { ConnectionEntry } from '../protocol'

export interface ConnectionChooser {
  element: HTMLElement
  /** Shows or clears the line that says why the document needs a connection. */
  setNotice(text: string | undefined): void
  /** Replaces the options, keeping the placeholder, when the registry changed. */
  setEntries(entries: ConnectionEntry[]): void
  /** Back to the placeholder, so the same entry can be chosen again after it failed. */
  reset(): void
}

export function createConnectionChooser(
  entries: ConnectionEntry[],
  onChoose: (ref: string) => void,
  disabled: boolean,
): ConnectionChooser {
  const element = document.createElement('div')
  element.className = 'chooser'
  const notice = document.createElement('div')
  notice.className = 'notice'
  notice.hidden = true

  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Choose connection')
  select.disabled = disabled
  function fill(listed: ConnectionEntry[]): void {
    select.replaceChildren(
      new Option('Choose connection', ''),
      ...listed.map((entry) => new Option(optionText(entry), entry.ref)),
    )
  }
  fill(entries)
  select.addEventListener('change', () => {
    if (select.value !== '') onChoose(select.value)
  })

  element.append(notice, select)
  return {
    element,
    setNotice(text) {
      notice.hidden = text === undefined
      notice.textContent = text ?? ''
    },
    setEntries: fill,
    reset() {
      select.value = ''
    },
  }
}
