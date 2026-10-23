import hljs from 'highlight.js/lib/core'
import sql from 'highlight.js/lib/languages/sql'

const highlighter = hljs.newInstance()
highlighter.registerLanguage('sql', sql)

export function highlightSql(query: string): string {
  return highlighter.highlight(query, { language: 'sql', ignoreIllegals: true }).value
}
