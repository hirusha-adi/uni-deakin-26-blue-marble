import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import SqlQuery from '../components/SqlQuery'
import { buildLoginQuery, SQL_ATTACK_USERNAME } from './sqlDemo'
import { highlightSql } from './sqlHighlight'

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#x60': '`' }
const decode = (html: string) => html.replace(/&(amp|lt|gt|quot|#x27|#x60);/g, (_, entity: string) => entities[entity])
const textContent = (html: string) => decode(html.replace(/<\/?span\b[^>]*>/g, ''))
const comments = (html: string) => [...html.matchAll(/<span class="hljs-comment">([\s\S]*?)<\/span>/g)].map((match) => decode(match[1]))

describe('SQL query highlighting', () => {
  it('highlights the whole query while ending a line comment at an actual newline', () => {
    const query = buildLoginQuery(SQL_ATTACK_USERNAME, 'anything', 'vulnerable')
    const html = highlightSql(query)
    expect(html).toContain('<span class="hljs-keyword">SELECT</span>')
    expect(html).toContain('<span class="hljs-keyword">WHERE</span>')
    expect(comments(html)).toEqual(["--' AND password = 'anything'"])
    expect(html).toMatch(/<\/span>\nLIMIT /)
    expect(textContent(html)).toBe(query)
  })

  it('keeps the entire remainder of a long, wrapping line inside its comment', () => {
    const comment = `-- ${'password check is skipped '.repeat(10)}AND password = 'anything' LIMIT 1;`
    const query = `SELECT 1 ${comment}`
    expect(comments(highlightSql(query))).toEqual([comment])
    expect(textContent(highlightSql(query))).toBe(query)
  })

  it('keeps a block comment across newlines and resumes highlighting after it', () => {
    const comment = '/* skip\nAND password = 42\n*/'
    const html = highlightSql(`SELECT 1 ${comment}\nFROM users;`)
    expect(comments(html)).toEqual([comment])
    expect(html).toContain('<span class="hljs-keyword">FROM</span>')
  })

  it('keeps escaped quotes and SQL-looking text inside strings, including unfinished input', () => {
    const query = "SELECT 'it''s -- WHERE 42', 'unfinished AND 1=1"
    const html = highlightSql(query)
    expect(comments(html)).toEqual([])
    const strings = [...html.matchAll(/<span class="hljs-string">([\s\S]*?)<\/span>/g)].map((match) => decode(match[1]))
    expect(strings).toEqual(["'it''s -- WHERE 42'", "'unfinished AND 1=1"])
    expect(textContent(html)).toBe(query)
  })

  it('preserves protected placeholders, tabs, line endings and surrounding whitespace', () => {
    const queries = [
      buildLoginQuery('student', 'anything', 'protected'),
      '  SELECT\t"username", `role`, [display_name]\r\nFROM users\nWHERE username = ? AND password = ?;  ',
    ]
    for (const query of queries) expect(textContent(highlightSql(query))).toBe(query)
  })

  it('renders user markup as escaped text rather than executable HTML', () => {
    const query = buildLoginQuery('<script>alert(1)</script><img src=x onerror=alert(1)>&', 'anything', 'vulnerable')
    const markup = renderToStaticMarkup(createElement(SqlQuery, { query }))
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;&amp;')
    expect(markup).not.toMatch(/<(?:script|img)\b/i)
    expect(textContent(highlightSql(query))).toBe(query)
  })
})
