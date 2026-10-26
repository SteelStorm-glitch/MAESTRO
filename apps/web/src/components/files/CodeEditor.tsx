import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'

function languageFor(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx'].includes(ext)) return [javascript({ typescript: true, jsx: ext === 'tsx' })]
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return [javascript({ jsx: ext === 'jsx' })]
  if (ext === 'json') return [json()]
  if (ext === 'py') return [python()]
  if (['md', 'mdx'].includes(ext)) return [markdown()]
  if (ext === 'html' || ext === 'htm') return [html()]
  if (['css', 'scss', 'less'].includes(ext)) return [css()]
  return []
}

const maestroTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', height: '100%' },
    '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#2b2b45',
    },
    '.cm-gutters': { backgroundColor: 'var(--bg-base)', color: 'var(--text-faint)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-line': { padding: '0 8px' },
  },
  { dark: true },
)

export function CodeEditor({
  value,
  path,
  readOnly = true,
  minHeight,
}: {
  value: string
  path: string
  readOnly?: boolean
  minHeight?: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      maestroTheme,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      ...languageFor(path),
    ]
    const state = EditorState.create({ doc: value, extensions })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [value, path, readOnly])

  return <div ref={hostRef} className="h-full w-full overflow-hidden" style={minHeight ? { minHeight } : undefined} />
}
