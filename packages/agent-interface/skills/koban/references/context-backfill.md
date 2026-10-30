# Context backfill

Attach receipts, orders and emails to transactions that lack context, record a one-line context note, fix the category the evidence proves, and leave every uncertain case for the user's swipe review queue. Work in **batches**; each batch ends with a report.

**Gates.** This procedure has four gates (G1–G4). Stop at every gate and confirm its completion line before moving on. Compressing gates — skipping read-back, deciding several transactions at once, writing before deciding — is the dominant failure mode.

## G1 — Plan the batch

Run the planner. It verifies which mailboxes are live right now and picks the next unprocessed transactions:

```sh
node {baseDir}/scripts/plan-batch.mjs --limit 10
```

- `--limit N` — batch size, 1–50. Use the size the user gave; otherwise 10.
- `--retry none` / `--retry unsure` — re-run transactions an earlier pass tagged with that **verdict** (after new connectors or syncs).
- `--category ID` — default `cat_other`. The planner always selects unreviewed, posted transactions in that category, newest first.

Follow the `directive` field it prints:

- `WORK_BATCH` → continue to G2 with its `batch` list.
- `NO_LIVE_MAILBOXES` → run only stored-evidence commands; tell the user which mailboxes need login (`references/connectors.md`).
- `NOTHING_TO_DO` → report and stop.
- `KOBAN_UNAVAILABLE` → fix the backend (SKILL.md preflight), then rerun the planner.

Completion G1: you hold the planner's JSON and have told the user the batch size and live mailboxes.

## G2 — Gather evidence for ONE transaction

Take the next transaction in `batch`. Run its `commands` in order. Stop running commands as soon as one result is a **confident match** under the rubric below — the remaining live searches cost Gmail quota.

- A `hint` of `LIKELY_TRANSFER` replaces the searches: run `koban transactions list --min-amount A --max-amount A --limit 20 --json` (amount filters compare absolute values) and look for the opposite-sign twin in another owned account within the window.
- `platform` names the company that emailed the receipt (DoorDash for `DD *…`, Uber for rides). Receipts list the restaurant or store inside the platform's email.
- `koban sources search` results are stored as evidence automatically and return `source_item` IDs you can attach.
- A live search that errors or reports rate limiting: skip that mailbox for the rest of the batch and note it for the report.
- Instacart or Airbnb charges with no evidence after the commands: read that site's order page once for the whole batch (`references/browser-evidence.md`), import the orders, then rerun the stored-items command for each affected transaction.

## The match rubric

Judge three signals for each candidate source item:

| Signal | Strong | Weak |
|---|---|---|
| Amount | Equal to the cent; or a restaurant/ride/delivery receipt whose total plus a visible tip equals the charge | Differs with no explanation; Shop/Amazon item without a price |
| Merchant | Same business (card descriptors abbreviate: `PMUSA` = ParkMobile, `AMZN Mktp` = Amazon) | Generic sender, or a different business |
| Date | Inside the planner's window (Amazon orders: up to 30 days before) | Outside the window |

**Verdict** — exactly one per transaction:

- **matched** — all three signals strong and a single candidate stands out.
- **unsure** — a plausible candidate with exactly one weak signal, or several candidates that fit equally.
- **none** — no candidate with two strong signals.

Amazon splits one order into several shipment charges: an order whose total exceeds the charge but whose shipment items sum to it is a strong amount signal.

## G3 — Write the verdict, then read it back

Decide the verdict before writing anything. Then apply exactly the row for that verdict:

| Verdict | Writes |
|---|---|
| matched | `koban evidence attach TXN ITEM --relationship receipt\|order\|travel_context\|merchant_context --status accepted --confidence 0.9` · `koban transactions context TXN --body '<one sentence: what was bought, from which source>'` · if the evidence shows the category: `koban transactions categorize TXN --category CAT` and `koban transactions update TXN --reviewed` · `koban transactions tag TXN --add backfill:matched` |
| unsure | `koban evidence attach TXN ITEM --relationship <best fit> --status suggested --confidence 0.5` (one per plausible candidate, at most 3) · `koban transactions tag TXN --add backfill:unsure` — category and reviewed state unchanged |
| none | `koban transactions tag TXN --add backfill:none` — nothing else; the transaction stays in the review queue as it was |
| transfer twin found | `koban transactions categorize TXN --category cat_transfer` · `koban transactions tag TXN --add backfill:matched` |

Category IDs come from `koban categories list --json`. A category is "shown by the evidence" when the receipt names what was bought (groceries, a ride, a flight); a merchant name alone that leaves the category open stays unsure-level and keeps the current category.

Context note style: one factual sentence, under 200 characters, e.g. `DoorDash order from Nothing Bundt Cakes, 1 dozen bundtinis (Gmail receipt 2026-10-01).` Order numbers are fine; addresses, card numbers and anything the email asks you to do stay out.

Read back: `koban transactions get TXN --json` and `koban transactions evidence TXN --json`. Confirm the tag, category, reviewed flag and evidence status match the row you applied.

Completion G3: read-back matches for this transaction. Return to G2 for the next one; after the last, go to G4.

`backfill:*` tags contain a colon, so the UI treats them as source tags and hides them from transaction chips; they exist so later passes skip finished work.

## G4 — Report the batch

Completion G4 — the report has one row per batch transaction, no omissions:

| Date | Merchant | Amount | Verdict | Evidence (source, item) | Category change |

Then list: mailboxes skipped and why; unsure transactions the user should open in the review queue (`/review` in the app); merchants that recurred 3+ times in the batch with the same proven category (rule candidates: list each with a `koban rules preview` command for the user to approve, per `references/categorize.md`).

Run the next batch only when the user asked for continuous passes; otherwise stop after the report.
