export const XSS_PAYLOAD = `<img src=x onerror="alert('XSS demo!')">`
export const XSS_PLAIN_COMMENT = 'Excited for the Blue Marble Study Tour!'
export const XSS_MAX_LENGTH = 1600
export const XSS_MESSAGE_TYPE = 'blue-marble-xss-alert'
export const XSS_SANDBOX = 'allow-scripts'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

/** Untrusted markup is only ever inserted into this opaque-origin sandbox. */
export function buildXssDocument(comment: string, protectedMode: boolean): string {
  const content = comment.slice(0, XSS_MAX_LENGTH)
  const renderedComment = protectedMode ? escapeHtml(content) : content

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; color: #172d29; background: #f7f9f5; font: 14px/1.6 system-ui, sans-serif; }
  .label { font-size: 10px; letter-spacing: .13em; font-weight: 700; color: #71807a; }
  h2 { margin: 7px 0 18px; font-size: 19px; letter-spacing: -.04em; }
  .comment { padding: 17px; border: 1px solid #e1e7e1; border-radius: 12px; background: white; overflow-wrap: anywhere; }
  .author { font-size: 12px; font-weight: 650; margin-bottom: 8px; }
  #message { display: none; margin-top: 14px; padding: 12px; border-radius: 10px; border: 1px solid #f5c2a9; background: #fff1e7; color: #884a2c; font-weight: 600; }
</style>
<script>
  window.alert = function (message) {
    var text = typeof message === 'string' ? message.slice(0, 140) : 'Demo script executed';
    var banner = document.getElementById('message');
    if (banner) { banner.style.display = 'block'; banner.textContent = 'Script executed: ' + text; }
    parent.postMessage({ type: '${XSS_MESSAGE_TYPE}', message: text }, '*');
  };
</script></head><body>
<div class="label">FICTIONAL STUDENT NOTICEBOARD</div>
<h2>Study tour discussion</h2>
<div class="comment"><div class="author">New student · just now</div><div>${renderedComment}</div></div>
<div id="message" role="status"></div>
</body></html>`
}

export function readXssMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as Record<string, unknown>
  if (candidate.type !== XSS_MESSAGE_TYPE || typeof candidate.message !== 'string') return null
  return candidate.message.slice(0, 140)
}
