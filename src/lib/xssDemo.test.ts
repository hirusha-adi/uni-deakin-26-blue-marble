import { describe, expect, it } from 'vitest'
import { buildXssDocument, escapeHtml, readXssMessage, XSS_MESSAGE_TYPE, XSS_PAYLOAD, XSS_SANDBOX } from './xssDemo'

describe('XSS demonstration boundary', () => {
  it('escapes every HTML delimiter in protected comments', () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe('&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;')
    const protectedDocument = buildXssDocument(XSS_PAYLOAD, true)
    expect(protectedDocument).not.toContain(XSS_PAYLOAD)
    expect(protectedDocument).toContain(escapeHtml(XSS_PAYLOAD))
  })

  it('keeps executable demo HTML inside an opaque-origin, resource-restricted frame', () => {
    const document = buildXssDocument(XSS_PAYLOAD, false)
    expect(document).toContain(XSS_PAYLOAD)
    expect(XSS_SANDBOX).toBe('allow-scripts')
    expect(document).toContain("default-src 'none'")
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain("form-action 'none'")
    expect(document).toContain("frame-src 'none'")
  })

  it('accepts only bounded demo messages and rejects malformed data', () => {
    expect(readXssMessage(null)).toBeNull()
    expect(readXssMessage({ type: XSS_MESSAGE_TYPE, message: {} })).toBeNull()
    expect(readXssMessage({ type: 'unrelated', message: 'x' })).toBeNull()
    expect(readXssMessage({ type: XSS_MESSAGE_TYPE, message: 'x'.repeat(900) })).toHaveLength(140)
  })
})
