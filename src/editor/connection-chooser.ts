// The "Choose connection" control a query document shows until it names a connection. Q1, ADR 0003
import type { ConnectionEntry } from '../protocol'

export interface ConnectionChooser {
  element: HTMLElement
  /** Shows or clears the line that says why the document needs a connection. */
  setNotice(text: string | undefined): void
}

export function createConnectionChooser(
  entries: ConnectionEntry[],
  onChoose: (ref: string) => void,
): ConnectionChooser {
  const element = document.createElement('div')
  element.className = 'chooser'
  const notice = document.createElement('div')
  notice.className = 'notice'
  notice.hidden = true

  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Choose connection')
  const placeholder = new Option('Choose connection', '')
  select.append(placeholder)
  for (const entry of entries)
    select.append(new Option(`${entry.name} (${entry.detail})`, entry.ref))
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
  }
}
