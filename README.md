# Blue Marble Study Tour 2026 — Security Lab

A beginner-friendly cybersecurity teaching app built with Next.js App Router, React, TypeScript, and Tailwind CSS. Password attacks, XSS, and SQL injection run in the browser. The prompt-injection challenge uses a Next.js server route to chat with OpenAI while keeping the API key and challenge flag on the server.

## Run locally

Requires Node.js 22.12+ (or a newer supported release).

```bash
npm ci
npm run dev
```

Open the local URL printed by Next.js, normally `http://127.0.0.1:3000`.

### Set up the chat challenge

Copy `.env.example` to `.env.local`, then set `OPENAI_API_KEY` and a private `PROMPT_CHAT_FLAG` such as your own `BM26{...}` value. The chat uses `gpt-4o-mini`, as selected for this workshop; `OPENAI_MODEL` can override it. Keep these variables server-only: never add the `NEXT_PUBLIC_` prefix. `.env.local` is ignored by Git.

Edit [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md) to change the assistant's personality or challenge difficulty. Keep the `{{FLAG}}` placeholder: the server replaces it with the private flag at request time. The system prompt is never displayed in the chat. The model is instructed to guard the flag, but its replies are deliberately not filtered for the flag: persuading the model to disclose it is the game. The assistant has no tools or access to the API key. A successful plaintext flag disclosure earns a “Flag captured” badge.

Students create named sessions and switch between saved conversations. A session allows **15 exchanges: 15 student messages plus 15 assistant replies, for 30 messages total**. The server reserves a turn before calling OpenAI, blocks competing requests and further turns at the limit, and deduplicates retries. Failed or unfinished API replies do not use a turn. At the limit, the message box is disabled and students are prompted to create a new session. The introductory UI text does not count as a chat message.

Each chat starts with a random UUID. Its conversation is saved in that student's browser using localStorage and backed up privately in `.data/prompt-chat-sessions.json`, outside the public directory and ignored by Git. An anonymous, HttpOnly cookie identifies the browser; no login is needed. The API lists and updates only sessions owned by that cookie, even if someone supplies another session's UUID or a forged browser identifier.

The local copy is tied to a public browser namespace derived from the private cookie. The app verifies that namespace with the server before restoring the saved selection, so changing or clearing the cookie cannot display a previous browser identity's cached chats. Server replies remain authoritative for messages and the 30-message limit; editing localStorage cannot add turns or overwrite the server backup. If local storage is unavailable or full, the chat keeps working with its server copy and shows a brief notice.

Students can play simultaneously on their own computers. Each device has its own anonymous identity and chat list; students do not need to create accounts. The server keeps all backup records privately while returning only the requesting browser's conversations. Creating a new chat generates another random UUID within that browser's own history.

Refreshing or restarting the server preserves sessions. Clearing the cookie or changing browsers starts a different session list; there is no account-based recovery. Messages and conversation history are sent to OpenAI with `store: false`; students should use fictional scenarios.

The file store requires **one Node.js process and a persistent writable disk**. Set `PROMPT_CHAT_DATA_DIR` to a private persistent directory when hosting. For multiple server instances or serverless deployments, replace it with a shared transactional database. Deploy `SYSTEM_PROMPT.md` with the server; Next's file tracing includes it for the chat endpoint. Keep the data directory private, and remove old workshop transcripts when no longer needed.

Model availability was checked on 2026-10-23. OpenAI currently lists `gpt-4o-mini` for retirement on January 14, 2027; change `OPENAI_MODEL` and check the request parameters before that date. See the [model documentation](https://developers.openai.com/api/docs/models/gpt-4o-mini) and [deprecation schedule](https://developers.openai.com/api/docs/deprecations).

## Demonstrations

- **Brute force:** a Web Worker tries combinations in shortest-first order. The default PIN `042` is found after 153 actual comparisons. Every comparison is retained in a numbered, scrollable live log. Change the alphabet, maximum length, or teaching pace; stop and reset at any time. The demonstration caps execution at one million guesses and reports when the target is outside the search settings.
- **Dictionary attack:** tries an editable wordlist, with optional common case and suffix variations. The default `password123` is found on guess 12. A completed list without a match is reported as exhausted, rather than declaring the password unbreakable.
- **Password strength:** [zxcvbn](https://github.com/dropbox/zxcvbn) supplies a live score, pattern feedback, and estimates with explicit offline/online assumptions. The paced demonstration timer measures a different thing from those estimates. This lesson compares made-up plaintext passwords; real services normally verify password hashes.
- **XSS:** an unescaped comment executes in an opaque-origin sandboxed iframe. Demo alerts appear in the interface. Protected mode HTML-escapes the same input. The sandbox cannot access the parent app, and content security policies restrict resource requests and external frame navigation.
- **SQL injection:** [sql.js](https://sql.js.org/) runs real SQLite in WebAssembly against a temporary fictional account table. The username `admin' --` bypasses the vulnerable password check. Protected mode binds the input to placeholders and rejects the same payload. The database is created and closed for every attempt; readable passwords are a teaching simplification.
- **Prompt injection:** a real chat challenge in which students try to persuade an IT assistant to disclose a fictional flag. Named sessions retain their conversations and enforce the 30-message limit on the server.
- **Phishing:** a visible, disabled option for a future demonstration.

Choose a demo, edit the example input, and run it. Search settings, timing, progress, strength estimates, and explanations are visible in a plain layout. The password log follows new attempts by default; scroll back to review earlier guesses. It retains the complete run while rendering only the visible rows to keep large searches responsive. Resetting, editing password settings, starting again, or switching demos clears the current password run. Password and injection inputs stay in browser memory; chat conversations are saved in the browser and on the server. Assets, including Roboto, the SQLite WebAssembly file, and zxcvbn dictionaries, are bundled locally.

## Check and build

```bash
npm run typecheck
npm test
npm run build
npm start
```

Unit tests cover password enumeration, list transformations, SQL protection, XSS output encoding, chat ownership and persistence, browser-copy validation and isolation, concurrent turn limits, retries, API validation, and safe provider failures. Provider tests mock OpenAI and do not spend API credits. Run browser QA only when explicitly requested; the existing `npm run test:e2e` script uses Playwright.

`npm run build` creates the production Next.js application in `.next/`; `npm start` serves it on port 3000. `npm run preview` serves the production build on port 4173. Next.js serves the page, local assets, and the chat API routes. Password attempts, SQLite queries, and sandboxed JavaScript execute in the browser.

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
- `src/components/PromptInjectionLab.tsx`: chat, named sessions, message counter, and session-limit UI.
- `src/lib/promptChatBrowser.ts`: browser-local conversation copy, owner namespace checks, and safe storage handling.
- `src/app/api/prompt-chat/`: private session listing, creation, and message endpoints.
- `src/lib/server/promptChatStore.ts`: private persistent sessions, owner checks, and turn reservation.
- `src/lib/server/promptChatProvider.ts`: server-only OpenAI calls and system prompt loading.
- `SYSTEM_PROMPT.md`: editable challenge instructions with a private flag placeholder.
- `tests/e2e.spec.ts`: browser regression checks.
