# AI Finances

A local-first personal finance app. Your banks sync in, every transaction gets categorized and enriched with real-world context (receipts, orders, emails), and an AI agent answers questions from your own ledger — all on your machine by default.

- **Bank sync** via [Plaid](https://plaid.com) — multiple institutions, balances, transactions, honest sync status. SnapTrade (investments) and SimpleFIN also supported.
- **Local database** — embedded Postgres ([PGlite](https://pglite.dev) + pgvector) with zero setup; flip one env var for real Postgres.
- **Semantic search** over transactions and evidence (⌘K from anywhere) — local embeddings by default, [Voyage](https://voyageai.com) when you bring a key.
- **Rules** — `contains` / `equals` / `regex` matching with bounded validation and batch apply.
- **AI enrichment** — reviewable category/tag suggestions with confidence scores, batch accept/dismiss. Nothing mutates your ledger without your approval.
- **Context sources** — Gmail, Outlook, Amazon, Instacart, Airbnb adapters plus JSON/CSV/EML/MBOX/ICS/ZIP imports link real evidence to opaque bank rows.
- **Agent** — ask-your-finances chat grounded in your local ledger, metrics, and evidence.
- **Installable PWA**, single-user auth mode, and a Dockerfile for hosted deploys.

## Quickstart

```bash
pnpm install
cp .env.example .env          # add your Plaid client id/secret
pnpm --dir apps/web dev --hostname 127.0.0.1 --port 3007
```

Open `http://127.0.0.1:3007` → Settings → Connections → **Connect bank account**. The first sync runs automatically after Plaid Link completes.

Everything else is optional and off until configured:

| Capability | Enable with |
| --- | --- |
| Real Postgres instead of embedded PGlite | `POSTGRES_PASSWORD=… docker compose up -d db`, then `DATABASE_URL=postgres://postgres:…@localhost:5433/finances` |
| Migrate an existing local ledger to Postgres | `pnpm --dir apps/web migrate:postgres` (prints per-table counts, never connection strings) |
| Hosted AI enrichment & agent | `AI_FINANCES_LLM_PROVIDER` + key for any OpenAI-compatible endpoint, or Ollama |
| Hosted embeddings for semantic search | `VOYAGE_API_KEY` (`voyage-4-large` default) |
| Single-user auth (hosted deploys) | `AI_FINANCES_AUTH_TOKEN` |
| Background sync | Settings → Sync schedule, or `pnpm sync:due` / `sync:now` / `sync:watch` |

With nothing configured, the app is fully functional and fully local — no financial data leaves your machine.

## Development

```bash
pnpm --dir apps/web exec tsc --noEmit   # typecheck
pnpm --dir apps/web test                # unit tests (vitest)
pnpm --dir apps/web build               # production build → .next-build
pnpm --dir apps/web test:e2e            # Playwright — seeds its own throwaway DB, uses .next-e2e
```

Build outputs are isolated per mode (`.next` dev / `.next-build` prod / `.next-e2e` tests), so checks never corrupt a running dev server.

```
apps/web/               Next.js app — UI, /api/v1 resource API, sync pipeline
  lib/                  server logic: providers (Plaid/SnapTrade/SimpleFIN), DB boundary, sources, rules, AI
  components/           finance UI on shadcn (Base UI) with the Ink & Mint theme
packages/schema/        shared domain types
packages/sync-protocol/ provider adapter contracts
docs/architecture/      API & data-model design
```

Amount convention: spending is negative, income/credits positive; credit-card signs are normalized from each provider's liability convention. Transfers are excluded from spending metrics. The `/api/v1` surface follows Stripe-style resource conventions — list envelopes, snake_case objects, deliberate 400s — so agents and automations can build on it directly. Deeper design notes: [docs/architecture/finance-api-db-design.md](docs/architecture/finance-api-db-design.md).

## Deploying

`Dockerfile` builds a standalone image; `docker-compose.yml` provides Postgres with pgvector (port 5433, `postgres-data` volume). For hosted environments set `DATABASE_URL`, `AI_FINANCES_AUTH_TOKEN`, and your Plaid credentials (`PLAID_CLIENT_ID`, `PLAID_SECRET`).

## License

[MIT](LICENSE)
