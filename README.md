# Email News Summarizer

Extract news links from a Gmail email, send them to a Cloudflare Worker for summarization, and render concise bullet points in-page via a Tampermonkey userscript. Summarization is adapter-based so different AI APIs can be swapped in; OpenAI is the default. The client sends all detected links; the Worker enforces how many get summarized.

## Architecture

- **Tampermonkey client**: injects a small UI, scrapes links from the open email body, and posts `{links, readingTime}` to the backend. Displays headline (hyperlinked) and bullets returned.
- **Cloudflare Worker backend**: validates requests, fetches each article, and calls a summarizer adapter. Deduplicates links and returns structured summaries.
- **Summarizer adapters**: interface-based; `OpenAISummarizer` is included, others can be added behind the same contract.

## Setup

1. Install dependencies: `npm install`
2. Configure env (Worker):
   - `OPENAI_API_KEY`: key for the OpenAI Chat Completions API.
   - `SUMMARIZER` (optional): `openai` (default). Extendable later.
   - Local dev: put env in `.dev.vars`; an example is in `.env.example`.
   - Optional `API_TOKEN`: bearer token required on incoming requests for auth. Set via `wrangler secret put API_TOKEN`.
3. Deploy the Worker via Wrangler (see “Deploy to Cloudflare” below); ensure it exposes `POST /summaries`.
4. Update `BACKEND_URL` in `src/client/gmail.js` to your Worker endpoint, then install it directly as a Tampermonkey userscript (no build step).

## Deploy to Cloudflare (Wrangler)

1) Install Wrangler: `npm install -D wrangler` (once per repo).  
2) `wrangler.toml` is present:
```
name = "email-reader"
main = "src/worker.ts"
compatibility_date = "2024-11-17"
```
3) Authenticate: `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN`).  
4) Set secrets (at least your OpenAI key): `npx wrangler secret put OPENAI_API_KEY` (and `SUMMARIZER` if you add adapters).  
5) Local preview (Miniflare): `npx wrangler dev` (POST to `http://127.0.0.1:8787/summaries`).  
6) Deploy: `npx wrangler deploy`. The resulting URL is your `BACKEND_URL` (append `/summaries`).  

Notes:
- Wrangler bundles everything under `src/`; you only ship the Worker entrypoint.
- The Tampermonkey client is separate: install `src/client/gmail.js` directly in Tampermonkey (metadata header kept), set `BACKEND_URL` to the deployed Worker.
- If `API_TOKEN` is set, requests must include `Authorization: Bearer <API_TOKEN>`. The userscript can set `API_TOKEN` at the top of `src/client/gmail.js` to send this header.

## Development workflow (TDD-first)

- Add a failing test in `tests/` for the unit you are extending (e.g., reading-time rules, adapter behavior, Worker validation).
- Implement the minimal code to make it pass.
- Keep the Tampermonkey UI small and composable; prefer pure functions for link extraction to keep them testable.
- Run tests: `npm test` (Vitest). For types: `npm run typecheck`.

## Reading time contract

- Input: `quick` | `default` | `long`.
- Mapping lives in `src/readingTime.ts` and controls bullet count, token budget, and headline length.

## File guide

- `src/worker.ts` — Cloudflare Worker entrypoint; validates payloads and orchestrates summarization.
- `src/articles.ts` — fetch + text extraction + dedupe helpers.
- `src/readingTime.ts` — reading-time profiles and coercion.
- `src/summarizer/` — adapter factory and OpenAI adapter.
- `src/client/gmail.js` — UI/button injection for Gmail + backend call (plain JS, install directly).
- `tests/` — Vitest unit tests for the core logic and Worker validation.

## Style and conventions

- TypeScript, strict mode.
- No network calls in tests; mock `fetch` and adapters.
- Docs + changelog entries accompany meaningful code changes.
- Keep UI additions minimal and easy to remove; avoid mutating Gmail DOM outside the container you inject.

## Usage (high level)

1. Open an email in Gmail with links.
2. Click the ✍️ icon in the Gmail top bar to open the side panel. Pick reading time (`quick`, `default`, `long`). Press “Summarize”.
3. Backend returns headline + bullet list per link; links remain clickable. The header shows the count; timing is displayed above results.

## Extending (new summarizer)

1. Implement `SummarizerAdapter` in `src/summarizer/<name>.ts`.
2. Add adapter selection to `buildSummarizer` in `src/summarizer/index.ts`.
3. Add tests covering adapter selection and failure modes.

## Testing notes

- Worker tests mock both the summarizer factory and `fetch` to avoid live calls.
- Reading-time tests guard the profile mapping. Add more as policies evolve.
- Run `npm test`. Typecheck: `npm run typecheck`.

## Limits and server behavior

- Client sends all detected links; Worker enforces `articleLimit` and `maxArticles` (passed from the client) to cap OpenAI calls and control spend.
- Links are deduped and summarized in parallel; response order matches the input order.
- Headlines prefer the article page `<title>` (cleaned of site suffixes like “| …”) before falling back to model output or URL.
- Server logs include counts (received/deduped/summaries/skipped/OpenAI calls) and average adapter time per request.

## Roadmap (suggested)

- Add Chrome extension packaging and/or Gmail add-on manifest.
- Add article parsing improvements (readability extraction).
- Add rate limiting / debounce on the Worker to prevent abuse.
- Add integration tests with Miniflare.
