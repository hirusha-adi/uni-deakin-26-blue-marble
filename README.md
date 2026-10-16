# Blue Marble Study Tour 2026 — Security Lab

A beginner-friendly cybersecurity teaching app built with Next.js App Router, React, TypeScript, and Tailwind CSS. Every demonstration runs in the browser; there is no API, authentication service, or remote database.

## Run locally

Requires Node.js 22.12+ (or a newer supported release).

```bash
npm ci
npm run dev
```

Open the local URL printed by Next.js, normally `http://127.0.0.1:3000`.

## Demonstrations

- **Brute force:** a Web Worker tries combinations in shortest-first order. The default PIN `042` is found after 153 actual comparisons. Every comparison is retained in a numbered, scrollable live log. Change the alphabet, maximum length, or teaching pace; stop and reset at any time. The demonstration caps execution at one million guesses and reports when the target is outside the search settings.
- **Dictionary attack:** tries an editable wordlist, with optional common case and suffix variations. The default `password123` is found on guess 12. A completed list without a match is reported as exhausted, rather than declaring the password unbreakable.
- **Password strength:** [zxcvbn](https://github.com/dropbox/zxcvbn) supplies a live score, pattern feedback, and estimates with explicit offline/online assumptions. The paced demonstration timer measures a different thing from those estimates. This lesson compares made-up plaintext passwords; real services normally verify password hashes.
- **XSS:** an unescaped comment executes in an opaque-origin sandboxed iframe. Demo alerts appear in the interface. Protected mode HTML-escapes the same input. The sandbox cannot access the parent app, and content security policies restrict resource requests and external frame navigation.
- **SQL injection:** [sql.js](https://sql.js.org/) runs real SQLite in WebAssembly against a temporary fictional account table. The username `admin' --` bypasses the vulnerable password check. Protected mode binds the input to placeholders and rejects the same payload. The database is created and closed for every attempt; readable passwords are a teaching simplification.
- **Phishing:** a visible, disabled option for a future demonstration.

Choose a demo, edit the example input, and run it. Search settings, timing, progress, strength estimates, and explanations are visible in a plain layout. The password log follows new attempts by default; scroll back to review earlier guesses. It retains the complete run while rendering only the visible rows to keep large searches responsive. Resetting, editing settings, starting again, or switching demos clears the previous run. All inputs remain in memory in the current browser session. Assets, including the SQLite WebAssembly file and zxcvbn dictionaries, are bundled locally; no CDN or external service is used.

## Check and build

```bash
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm start
```

Unit tests cover password enumeration, list transformations, boundary conditions, SQL protection, and XSS output encoding. Browser tests exercise both vulnerable and protected modes, sandbox isolation, worker cancellation, navigation, and mobile layouts.

`npm run build` creates the production Next.js application in `.next/`; `npm start` serves it on port 3000. `npm run preview` serves the production build on port 4173. Next.js serves the page and local assets; password attempts, SQLite queries, and sandboxed JavaScript all execute in the browser. There are no API routes or server actions.

The development and build scripts prepare `public/sql-wasm.wasm` from the installed sql.js package automatically. This generated binary is ignored by Git. Webpack bundles the dedicated password worker for both development and production. Tailwind uses its PostCSS integration.

Browser tests use port 3000 by default. If that port is occupied, run `PLAYWRIGHT_PORT=3001 npm run test:e2e` to select another port.

## Source map

- `src/app/layout.tsx`: document metadata and the content security policy.
- `src/app/page.tsx`: the App Router home page.
- `src/app/globals.css`: Tailwind styles.
- `src/App.tsx`: a single demo picker and study tour branding.
- `src/components/PasswordLab.tsx`: password configuration, live console, and strength feedback.
- `src/components/AttemptLog.tsx`: a virtualized, scrollable view of every password comparison.
- `src/workers/password.worker.ts`: paced execution outside the main UI thread.
- `src/lib/passwordEngine.ts`: deterministic attack plans and comparison engine.
- `src/components/InjectionLab.tsx`: XSS and SQL injection experiments.
- `src/lib/xssDemo.ts`: sandbox document generation and HTML escaping.
- `src/lib/sqlDemo.ts`: vulnerable and parameterized queries over ephemeral accounts.
- `tests/e2e.spec.ts`: browser regression checks.
