// The SQL editor's look: Orca's --orca-* variables, plus a syntax palette Orca does not offer. Q1
import {
  EditorView,
  HighlightStyle,
  type Extension,
  syntaxHighlighting,
  tags,
} from '../../vendor/codemirror.js'

/**
 * Syntax colours per theme, picked by the `light` / `dark` class Orca keeps on <html>. Each one
 * holds 4.5:1 against light backgrounds from white to #f0f0f0 and dark ones from black to #2b2b2b.
 * `:root` carries the light set as a default for a page with neither class. The editor reads them as variables, so a theme change repaints it without touching its state.
 */
export const PALETTE_STYLE = `
  html.light, :root { --sql-keyword: #7c3aa8; --sql-string: #0a6b3a; --sql-number: #a14a00;
    --sql-function: #0b5fa5; }
  html.dark { --sql-keyword: #c792ea; --sql-string: #8fd18f; --sql-number: #f0a35e;
    --sql-function: #6cb6ff; }
`

const SELECTION = 'color-mix(in srgb, var(--orca-primary) 30%, transparent)'

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--orca-foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { caretColor: 'var(--orca-foreground)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--orca-foreground)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: SELECTION },
  '.cm-activeLine': { backgroundColor: 'var(--orca-accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--orca-muted-foreground)',
    border: 'none',
    borderRight: '1px solid var(--orca-border)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--orca-accent)',
    color: 'var(--orca-accent-foreground)',
  },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    outline: '1px solid var(--orca-ring)',
  },
  '&.cm-focused .cm-nonmatchingBracket': { outline: '1px solid var(--orca-destructive)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--orca-popover)',
    color: 'var(--orca-popover-foreground)',
    border: '1px solid var(--orca-border)',
    borderRadius: 'var(--orca-radius, 4px)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--orca-accent)',
    color: 'var(--orca-accent-foreground)',
  },
  '.cm-completionDetail': { color: 'var(--orca-muted-foreground)' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--orca-primary)' },
})

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.typeName], color: 'var(--sql-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sql-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--sql-number)' },
  { tag: tags.standard(tags.name), color: 'var(--sql-function)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--orca-muted-foreground)' },
])

export const sqlTheme: Extension = [editorTheme, syntaxHighlighting(highlightStyle)]
