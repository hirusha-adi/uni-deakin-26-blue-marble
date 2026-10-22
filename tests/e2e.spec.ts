import { expect, test, type Page } from '@playwright/test'

async function openDemo(page: Page, name: 'Brute force' | 'Dictionary attack' | 'XSS demo' | 'SQL injection') {
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.locator('#lab-title')).toHaveText(name)
}

/** Read the complete history through the actual scrolling UI, including virtualized rows. */
async function readAttemptHistory(page: Page) {
  return page.getByRole('region', { name: 'All password attempts' }).evaluate(async element => {
    const observed = new Map<number, { attempt: number; guess: string; result: string }>()
    const inconsistencies: string[] = []
    let maximumRenderedRows = 0
    const collect = () => {
      const rows = [...element.querySelectorAll<HTMLTableRowElement>('tr[data-attempt]')]
      maximumRenderedRows = Math.max(maximumRenderedRows, rows.length)
      const indices = rows.map(row => Number(row.dataset.attempt))
      if (new Set(indices).size !== rows.length) inconsistencies.push('Duplicate row index in one rendered window')
      for (const row of rows) {
        const attempt = Number(row.dataset.attempt)
        const cells = row.querySelectorAll('td')
        const entry = { attempt, guess: JSON.parse(cells[1].textContent ?? '""') as string, result: cells[2].textContent ?? '' }
        if (Number(row.getAttribute('aria-rowindex')) !== attempt + 1) inconsistencies.push(`Incorrect accessible index for ${attempt}`)
        const previous = observed.get(attempt)
        if (previous && previous.guess !== entry.guess) inconsistencies.push(`Attempt ${attempt} changed while scrolling`)
        observed.set(attempt, entry)
      }
    }
    const bottom = Math.max(0, element.scrollHeight - element.clientHeight)
    for (let position = 0; position < bottom + element.clientHeight; position += element.clientHeight) {
      element.scrollTop = Math.min(position, bottom)
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      collect()
    }
    return { entries: [...observed.values()].sort((a, b) => a.attempt - b.attempt), inconsistencies, maximumRenderedRows }
  })
}

function decimalGuesses(maximumLength: number) {
  return Array.from({ length: maximumLength }, (_, length) =>
    Array.from({ length: 10 ** (length + 1) }, (_, value) => String(value).padStart(length + 1, '0')),
  ).flat()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#lab-title')).toHaveText('Brute force')
})

test('plain navigation offers each demo once with its settings visible', async ({ page }) => {
  await expect(page).toHaveTitle(/Blue Marble 2026/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cybersecurity demos')
  for (const name of ['Brute force', 'Dictionary attack', 'XSS demo', 'SQL injection']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
  }
  await expect(page.getByLabel('Characters to try')).toBeVisible()
  await expect(page.getByLabel('Maximum length')).toBeVisible()
  await expect(page.getByLabel('Demo pace', { exact: true })).toBeVisible()
  await openDemo(page, 'XSS demo')
})

test('brute force performs the correct comparisons and updates password strength', async ({ page }) => {
  await expect(page.getByLabel('Demo password', { exact: false }).first()).toHaveValue('042')
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Password found', { exact: true })).toBeVisible()
  await expect(page.getByText('Found “042” after 153 guesses.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('password-current-guess')).toHaveText('"042"')
  await expect(page.getByRole('table', { name: 'Password attempt history' })).toHaveAttribute('aria-rowcount', '154')
  const history = await readAttemptHistory(page)
  expect(history.entries).toEqual(decimalGuesses(3).slice(0, 153).map((guess, index) => ({
    attempt: index + 1, guess, result: index === 152 ? 'Match' : 'No match',
  })))
  expect(history.inconsistencies).toEqual([])
  expect(history.maximumRenderedRows).toBeLessThan(100)
  await page.getByLabel('Demo password', { exact: false }).first().fill('password')
  await expect(page.getByRole('meter', { name: 'Password strength score' })).toHaveAttribute('aria-valuenow', '0')
  await page.getByLabel('Demo password', { exact: false }).first().fill('orbit kiwi river cloud')
  await expect(page.getByRole('meter', { name: 'Password strength score' })).toHaveAttribute('aria-valuenow', '4')
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Outside search settings', { exact: true })).toBeVisible()
})

test('dictionary attack finds its default and reports a completed missing list', async ({ page }) => {
  await openDemo(page, 'Dictionary attack')
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Found “password123” after 12 guesses.', { exact: true })).toBeVisible()
  const history = await readAttemptHistory(page)
  expect(history.entries).toEqual([
    '123456', 'password', 'qwerty', 'letmein', 'welcome', 'admin', 'football', 'monkey', 'dragon', 'sunshine', 'iloveyou', 'password123',
  ].map((guess, index) => ({ attempt: index + 1, guess, result: index === 11 ? 'Match' : 'No match' })))
  expect(history.inconsistencies).toEqual([])
  await page.getByLabel('Demo password', { exact: false }).first().fill('not-in-this-list')
  await page.getByLabel('Your wordlist').fill('one\ntwo')
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Dictionary exhausted', { exact: true })).toBeVisible()
  await expect(page.getByText('This password was not in the list.', { exact: false })).toBeVisible()
  await page.getByLabel('Your wordlist').fill('')
  await expect(page.getByRole('button', { name: 'Start demo', exact: true })).toBeDisabled()
})

test('stopping a worker freezes the comparison count and lets the demo restart', async ({ page }) => {
  await page.getByRole('button', { name: 'Bigger search' }).click()
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  const progress = page.getByRole('progressbar', { name: 'Attack progress' })
  await expect.poll(async () => Number(await progress.getAttribute('value'))).toBeGreaterThanOrEqual(10_000)
  await expect(page.getByRole('table', { name: 'Password attempt history' })).toBeVisible()
  expect(await page.locator('tr[data-attempt]').count()).toBeLessThan(100)
  await page.getByRole('checkbox', { name: 'Follow latest' }).uncheck()
  await page.getByRole('region', { name: 'All password attempts' }).evaluate(element => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect(page.locator('tr[data-attempt="1"] td').nth(1)).toHaveText('"a"')
  await page.screenshot({ path: '/tmp/blue-marble-detailed-desktop-running.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Stop demo' }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  const stoppedCount = await progress.getAttribute('value')
  const history = page.getByRole('table', { name: 'Password attempt history' })
  const stoppedHistoryCount = await history.getAttribute('aria-rowcount')
  const elapsed = page.getByTestId('password-elapsed-time')
  const stoppedTime = await elapsed.textContent()
  await page.waitForTimeout(250)
  await expect(progress).toHaveAttribute('value', stoppedCount ?? '')
  await expect(history).toHaveAttribute('aria-rowcount', stoppedHistoryCount ?? '')
  await expect(elapsed).toHaveText(stoppedTime ?? '')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(progress).toHaveAttribute('value', '0')
  await expect(history).toHaveAttribute('aria-rowcount', '1')
  await expect(page.locator('tr[data-attempt]')).toHaveCount(0)
  await expect(elapsed).toHaveText('0.0 seconds')
  await page.getByRole('button', { name: '3-digit PIN' }).click()
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Found “042” after 153 guesses.', { exact: true })).toBeVisible()
  await expect(history).toHaveAttribute('aria-rowcount', '154')
})

test('fast batches retain every guess and rerunning replaces the full history', async ({ page }) => {
  await page.getByLabel('Demo password', { exact: true }).fill('999')
  await page.getByLabel('Demo pace', { exact: true }).selectOption('1000')
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Found “999” after 1,110 guesses.', { exact: true })).toBeVisible()
  const table = page.getByRole('table', { name: 'Password attempt history' })
  await expect(table).toHaveAttribute('aria-rowcount', '1111')
  const history = await readAttemptHistory(page)
  expect(history.entries).toEqual(decimalGuesses(3).map((guess, index) => ({
    attempt: index + 1, guess, result: index === 1109 ? 'Match' : 'No match',
  })))
  expect(history.inconsistencies).toEqual([])
  expect(history.maximumRenderedRows).toBeLessThan(100)
  await page.getByRole('button', { name: 'Run again', exact: true }).click()
  await expect(page.getByText('Found “999” after 1,110 guesses.', { exact: true })).toBeVisible()
  await expect(table).toHaveAttribute('aria-rowcount', '1111')
  await expect(page.locator('tr[data-attempt="1110"] td').nth(1)).toHaveText('"999"')
})

test('XSS executes in vulnerable mode and stays literal text in protected mode', async ({ page }) => {
  await openDemo(page, 'XSS demo')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('JavaScript executed.', { exact: true })).toBeVisible()
  await expect(page.getByText('Demo alert: XSS demo!', { exact: false })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Protection on' }).check()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Displayed as text.', { exact: true })).toBeVisible()
  const noticeboard = page.frameLocator('iframe[title="Isolated XSS noticeboard demonstration"]')
  await expect(noticeboard.locator('.comment')).toContainText(`<img src=x onerror="alert('XSS demo!')">`)
  await expect(noticeboard.locator('.comment img')).toHaveCount(0)
  await expect(noticeboard.locator('#message')).toBeHidden()
  await page.getByRole('button', { name: 'Normal comment' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(noticeboard.locator('.comment')).toContainText('Excited for the Blue Marble Study Tour!')
})

test('XSS sandbox prevents parent access and outside navigation', async ({ page }) => {
  await openDemo(page, 'XSS demo')
  const iframe = page.locator('iframe[title="Isolated XSS noticeboard demonstration"]')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  await page.getByLabel('Your noticeboard comment').fill(`<script>try { parent.document.body.dataset.xssEscaped = 'yes'; alert('Parent access allowed'); } catch (error) { alert('Parent access blocked'); }</script>`)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Demo alert: Parent access blocked', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => document.body.dataset.xssEscaped)).toBeUndefined()

  const externalRequests: string[] = []
  const securityMessages: string[] = []
  await page.route('https://example.com/**', async route => {
    externalRequests.push(route.request().url())
    await route.abort()
  })
  page.on('console', message => securityMessages.push(message.text()))
  await page.getByLabel('Your noticeboard comment').fill(`<script>window.location = 'https://example.com/xss-navigation-test';</script>`)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect.poll(() => securityMessages.some(message => message.includes('frame-src') && message.includes('example.com'))).toBe(true)
  expect(externalRequests).toEqual([])
  await expect(page).toHaveURL('/')
  await expect(page.locator('#lab-title')).toHaveText('XSS demo')
})

test('SQLite executes vulnerable injection but rejects it as bound data', async ({ page }) => {
  await openDemo(page, 'SQL injection')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Login successful', { exact: true })).toBeVisible()
  await expect(page.getByText('Welcome, Sam Student.', { exact: true })).toBeVisible()
  await expect(page.getByText('Account: student · Student', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Try a login bypass' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Welcome, Alex Admin.', { exact: true })).toBeVisible()
  await expect(page.getByText('Account: admin · Administrator', { exact: true })).toBeVisible()
  await expect(page.getByText('You reached the admin account without its password.', { exact: false })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Protection on' }).check()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Login rejected', { exact: true })).toBeVisible()
  await expect(page.locator('.code-panel').first()).toContainText('WHERE username = ? AND password = ?')
  await expect(page.getByText('Bound values — treated as data', { exact: true })).toBeVisible()
  await expect(page.locator('.code-panel').nth(1)).toContainText("admin' --")
  await expect(page.locator('.code-panel').nth(1)).toContainText('anything')
  await page.getByRole('button', { name: 'Valid student login' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Welcome, Sam Student.', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Protection on' }).uncheck()
  await page.getByLabel('Demo username').fill("'")
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Query could not run', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Valid student login' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Welcome, Sam Student.', { exact: true })).toBeVisible()
})

test('both labs fit a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const hasOverflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(await hasOverflow()).toBe(false)
  await page.screenshot({ path: '/tmp/blue-marble-detailed-mobile-password.png', fullPage: true, animations: 'disabled' })
  const longPassword = Array.from({ length: 64 }, (_, index) => String.fromCharCode(33 + (index * 37) % 90)).join('')
  await page.getByLabel('Demo password', { exact: true }).fill(longPassword)
  await expect(page.getByRole('meter', { name: 'Password strength score' })).toHaveAttribute('aria-valuenow', '4')
  expect(await hasOverflow()).toBe(false)
  await page.screenshot({ path: '/tmp/blue-marble-detailed-mobile-long-password.png', fullPage: true, animations: 'disabled' })
  await openDemo(page, 'Dictionary attack')
  expect(await hasOverflow()).toBe(false)
  await page.getByLabel('Demo password', { exact: true }).fill(longPassword)
  await page.getByLabel('Your wordlist').fill(`${longPassword}\nordinary`)
  await page.getByRole('button', { name: 'Start demo', exact: true }).click()
  await expect(page.getByText('Password found', { exact: true })).toBeVisible()
  await expect(page.locator('tr[data-attempt="1"] td').nth(1)).toHaveText(JSON.stringify(longPassword))
  expect(await hasOverflow()).toBe(false)
  expect(await page.getByTestId('password-attempt-log-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/blue-marble-detailed-mobile-long-guess.png', fullPage: true, animations: 'disabled' })
  await openDemo(page, 'XSS demo')
  expect(await hasOverflow()).toBe(false)
  await page.screenshot({ path: '/tmp/blue-marble-detailed-mobile-injection.png', fullPage: true, animations: 'disabled' })
  await openDemo(page, 'SQL injection')
  expect(await hasOverflow()).toBe(false)
  await page.screenshot({ path: '/tmp/blue-marble-detailed-mobile-sql.png', fullPage: true, animations: 'disabled' })
})

test('desktop lab renders without application errors', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  await expect(page.locator('#lab-title')).toHaveText('Brute force')
  await page.screenshot({ path: '/tmp/blue-marble-detailed-desktop-password.png', fullPage: true, animations: 'disabled' })
  await openDemo(page, 'XSS demo')
  await page.screenshot({ path: '/tmp/blue-marble-detailed-desktop-injection.png', fullPage: true, animations: 'disabled' })
  expect(failures).toEqual([])
})
