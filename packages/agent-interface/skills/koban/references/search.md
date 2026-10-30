# Search

Three surfaces, from cheapest to most expensive: the ledger, stored evidence, live mailboxes.

## Transactions (the ledger)

```sh
koban transactions list --q 'parkmobile' --limit 50 --json
koban transactions list --category cat_other --no-reviewed --limit 100 --json
koban transactions list --min-amount 35.04 --max-amount 35.04 --json
koban transactions get TXN --json
koban search 'coffee subscriptions' --limit 20 --json      # semantic, also covers evidence
```

- Results are newest first; follow `has_more` with `--starting-after <last id>`. `total_count` is the filtered total.
- Amount filters compare absolute values: `--min-amount 500 --max-amount 500` finds both −500 and +500.
- There is no date filter: page from the newest until rows pass the date you need.
- Filters: `--account`, `--category`, `--q`, `--min-amount`, `--max-amount`, `--review actionable|needs_review|reviewed|unreviewed|all`, `--reviewed/--no-reviewed`, `--status`.
- Money signs: outflow negative, income positive.

## Stored evidence (already imported source items)

```sh
koban sources items --from 2026-09-28 --to 2026-10-04 --amount 35.04 --json
koban sources items --q 'doordash bundt' --from 2026-09-01 --to 2026-09-30 --json
koban sources items --source source_gmail --q receipt --limit 20 --json
koban sources items --source source_amazon_orders --from 2026-09-01 --to 2026-10-01 --json
```

- `--from`/`--to`: inclusive `YYYY-MM-DD`. `--amount`: matches to the cent, either sign. `--q`: every word must appear across title, summary and merchant. `--kind`: e.g. `email`, `order`.
- `--source source_gmail` covers every Gmail mailbox (`source_gmail__*`); give a full profile ID for one mailbox.
- No complete pagination: an empty result means "not stored", not "never happened". Search live next.

## Live mailbox search

```sh
koban sources search source_gmail__personal --from 2026-09-28 --to 2026-10-04 --q 'DoorDash' --limit 10 --json
koban sources search source_outlook_email__personal --from 2026-09-01 --to 2026-09-30 --q 'invoice' --json
```

- Window at most 31 days; `--limit` 1–50. Matches are stored as source items (returned with IDs you can attach as evidence).
- Gmail `--q` accepts Gmail operators: `from:doordash.com`, `subject:receipt`, `"exact phrase"`.
- Outlook reads up to 250 messages in the window and keeps those containing every `--q` word.
- One mailbox at a time; Gmail's per-user quota is low.
- `koban connectors status --verify --json` tells you which mailboxes are live (`references/connectors.md`).

## Evidence already linked

```sh
koban transactions evidence TXN --json        # suggested + accepted links for one transaction
koban evidence list --status suggested --limit 50 --json
```
