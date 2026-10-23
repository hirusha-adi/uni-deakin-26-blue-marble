import 'highlight.js/styles/github.css'
import { highlightSql } from '../lib/sqlHighlight'

export default function SqlQuery({ query }: { query: string }) {
  return (
    <pre className="code-panel whitespace-pre-wrap break-words text-sm leading-relaxed">
      <code className="hljs language-sql" dangerouslySetInnerHTML={{ __html: highlightSql(query) }} />
    </pre>
  )
}
