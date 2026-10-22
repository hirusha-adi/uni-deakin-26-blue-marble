import { useLayoutEffect, useRef, useState } from 'react'

const ROW_HEIGHT = 28
const VIEWPORT_HEIGHT = 280
const OVERSCAN = 4
const number = new Intl.NumberFormat('en-AU')

export default function AttemptLog({ guesses, matched }: { guesses: string[]; matched?: string }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [followLatest, setFollowLatest] = useState(true)
  const count = guesses.length
  const previousCount = useRef(count)

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const shrank = count < previousCount.current
    previousCount.current = count
    if (shrank) {
      element.scrollTop = 0
      setScrollTop(0)
      setFollowLatest(true)
      return
    }
    if (followLatest) {
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight)
      element.scrollTop = bottom
      setScrollTop(bottom)
    }
  }, [count, followLatest])

  // 28px rows also keep the full one-million-attempt history below browser
  // layout height limits. Only the visible rows and a small buffer reach the DOM.
  const first = Math.min(count, Math.max(0, Math.floor(Math.max(0, scrollTop - ROW_HEIGHT) / ROW_HEIGHT) - OVERSCAN))
  const last = Math.min(count, first + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2 + 1)
  const visible = guesses.slice(first, last)
  const tableWidth = Math.max(320, ...visible.map((guess) => JSON.stringify(guess).length * 8.5 + 184))

  return (
    <div className="attempt-log">
      <div className="attempt-log-heading mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-xs text-muted">All {number.format(count)} attempts, in order</span>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={followLatest} onChange={(event) => setFollowLatest(event.target.checked)} className="h-4 w-4" />Follow latest</label>
      </div>
      <div ref={viewport} tabIndex={0} role="region" aria-label="All password attempts" data-testid="password-attempt-log-scroll" className="overflow-auto rounded border border-line bg-surface outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand" style={{ height: VIEWPORT_HEIGHT }} onScroll={(event) => {
        const element = event.currentTarget
        setScrollTop(element.scrollTop)
        if (element.scrollHeight - element.clientHeight - element.scrollTop > ROW_HEIGHT * 2) setFollowLatest(false)
      }}>
        <table aria-label="Password attempt history" aria-rowcount={count + 1} className="w-full table-fixed border-collapse text-left text-sm" style={{ minWidth: tableWidth }}>
          <thead className="sticky top-0 z-10 bg-[#fafafa]"><tr aria-rowindex={1} className="border-b border-line" style={{ height: ROW_HEIGHT }}><th scope="col" className="w-20 px-3 py-0 text-xs font-medium text-ink">Attempt</th><th scope="col" className="px-2 py-0 text-xs font-medium text-ink">Guess</th><th scope="col" className="w-24 px-3 py-0 text-xs font-medium text-ink">Result</th></tr></thead>
          <tbody>
            {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }}><td colSpan={3} className="p-0" /></tr>}
            {visible.map((guess, index) => {
              const attempt = first + index + 1
              const isMatch = guess === matched
              return <tr key={attempt} aria-rowindex={attempt + 1} data-attempt={attempt} className={`attempt-log-row border-b border-line ${isMatch ? 'attempt-log-match bg-brand-soft font-medium text-brand' : 'hover:bg-[#fafafa]'}`} style={{ height: ROW_HEIGHT }}><td className={`px-3 py-0 font-medium tabular-nums ${isMatch ? 'text-brand' : 'text-muted'}`}>{number.format(attempt)}</td><td className="whitespace-nowrap px-2 py-0 font-mono">{JSON.stringify(guess)}</td><td className={`px-3 py-0 ${isMatch ? 'font-medium' : 'text-muted'}`}>{isMatch ? 'Match' : 'No match'}</td></tr>
            })}
            {last < count && <tr aria-hidden="true" style={{ height: (count - last) * ROW_HEIGHT }}><td colSpan={3} className="p-0" /></tr>}
            {!count && <tr><td colSpan={3} className="px-3 py-5 text-muted">Press Start to watch every guess.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Scroll to review earlier attempts or read a long guess.</p>
    </div>
  )
}
