# Categorize, tag, rules, review queue

## One transaction

```sh
koban categories list --json                              # IDs: cat_other, cat_transfer, cat_income, custom cat_custom_…
koban transactions categorize TXN --category CAT
koban transactions update TXN --reviewed                  # or --no-reviewed
koban transactions tag TXN --add trip-nyc --remove needs-receipt
koban transactions context TXN --body 'One factual sentence.'
```

- `transactions tag` adds and removes atomically and keeps every other tag; `update --tags` replaces the whole list — use it only to set an exact list deliberately.
- Tags containing a colon (`backfill:matched`, `copilot:…`) are source tags: stored on the transaction and visible in `--json` output, hidden from the UI's chips. Plain tags show as chips.
- `transactions context` adds a note as linked evidence and keeps the notes field; `update --notes` replaces the notes field.
- Transfers between owned accounts go to `cat_transfer`; they leave spending metrics and the review queue.
- `koban categories create --name 'Tax' --emoji 🧾` when no existing category fits; prefer an existing one.

## Many transactions — preview, show the user, then apply

```sh
koban rules preview --field merchant_or_description --operator contains --value 'PMUSA' --json
koban rules create --name 'ParkMobile' --match-field merchant_or_description --match-operator contains --pattern 'PMUSA' --category CAT --json
koban transactions bulk-categorize --field merchant_name --operator equals --match 'Parkmobile' --category CAT --json
koban rules apply --json
```

`rules create` applies immediately to every match and to future syncs; `bulk-categorize` rewrites every match once. Both reach beyond the transactions in front of you, so show the user the preview count and a few sample rows and apply after they agree. `--mark-reviewed` on a rule removes its matches from the review queue.

## The swipe review queue (`/review` in the app)

- Shows the newest 100 unreviewed transactions that need action: everything in `cat_other`, plus spending and uncategorized income; `cat_transfer` and reviewed rows never appear.
- A card is flagged unsure when it has no pending category suggestion or the suggestion's confidence is below 0.74.
- Each card shows the transaction's linked evidence (accepted and suggested) and context notes; the user swipes to accept or recategorize and can add context there.
- So the hand-off for anything uncertain is: leave it unreviewed and attach candidates as `suggested` evidence — the user sees them on the card.
