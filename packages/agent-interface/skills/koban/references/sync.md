# Sync

```sh
koban sync status --json                                         # providers, schedule, last runs, LLM enrichment provider
koban sync run --timeout 600000 --json                           # banks + evidence sources + enrichment
koban sync run --source-ids source_amazon_orders --timeout 600000 --json
koban sources sync --json                                        # evidence sources only
koban sources sync source_shop_orders --json                     # one source
koban sources status --json                                      # per-source status, item counts, last import, errors
```

- A full sync can outlast the 2-minute default; pass `--timeout 600000`. A timeout stops the client, not a backend run already in progress — check `sync status` before starting another.
- The server also syncs on its own schedule (its ticker checks every 60 s).
- New bank transactions arrive uncategorized-or-provider-categorized and unreviewed; they are the next backfill's input.
- Overlays (category, tags, notes, reviewed, evidence decisions) survive resync. A Plaid pending charge gets a new transaction ID when it posts, so overlays on pending rows can be orphaned — work on posted rows.
- Source sync results: `itemsSeen`, `itemsWritten`, `evidenceLinksSuggested`. A connector that is not live fails its sync; fix it via `references/connectors.md` and rerun that source.
