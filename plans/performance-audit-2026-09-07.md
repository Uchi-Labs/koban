# Koban performance audit

Status: audit complete; implementation-plan selection pending. No source changes.

Audited 2026-09-07, branch `redesign/quiet`, HEAD `9c72882`, including existing uncommitted changes. Files changed concurrently during the audit; recheck excerpts before implementation. Scope is deep website performance, not a general security or product audit.

## Completed checklist

- [x] Inspect runtime, repository conventions, prior performance plans and verification commands.
- [x] Capture authenticated browser navigation timing and existing server logs.
- [x] Review backend, frontend, auth/runtime and performance-test coverage independently.
- [x] Verify reported source evidence and correct unsupported causal claims.
- [ ] User selects findings for self-contained implementation plans.

## Measured symptoms

These are observations under substantial host load, not controlled production benchmarks.

| Observation | Result |
|---|---:|
| Existing dashboard navigation: first response byte | 4.13 s |
| First contentful paint | 5.19 s |
| Document response download/streaming interval | 23.96 s |
| Window load event | 37.19 s |
| Repeat reload: first response byte | 89.03 s |
| Repeat reload: first contentful paint | 92.16 s |
| Repeat reload: window load event | 116.56 s |
| Server dashboard request examples | 27.5 s, 28.4 s, 41 s |
| Application-code portion of those requests | 26.1 s, 25.4 s, 39.5 s |
| Next compilation portion of those requests | 323 ms, 824 ms, 330 ms |
| Observed icon requests | 14.7–15.8 s |
| Repeated evidence-rematch queue timeout | 90 s, at least three warnings |

Runtime: Next.js 16.2.10 development server on port 3007, hosted Postgres configuration present. Dashboard reports 6,697 transactions and 26 accounts. No database credentials, individual records or account balances are reproduced here.

Host snapshot: 18 logical CPUs; load averages 131.63 / 63.82 / 29.71, later falling to 26.32 / 46.33 / 27.41. Next used approximately 98% CPU and 4.16 GB resident memory. Browser reported 15,992,140 decoded script bytes on reload; this is development output, not production transfer size or a production bundle measurement.

Conclusion: server work is the dominant observed wait. Evidence-rematch timeouts and repeated work are the highest-priority defects. Host contention and development overhead amplify the symptoms; exact per-function latency attribution requires profiling.

## Ranked findings

Effort: S = one localized change and focused verification; M = coordinated changes across a few modules; L = multiple contract-preserving slices. Risk describes the fix. Confidence is high for the cited code behavior; where runtime attribution is unmeasured it is stated separately.

| ID | Finding / category | Impact | Effort | Risk | Confidence | Evidence |
|---|---|---|---|---|---|---|
| 01 | Timeout retries leave old writes running / reliability-performance | A 60 s evidence timeout retries while the old Promise continues; the 90 s queue wrapper then advances without stopping its writer. Repeated timeout warnings observed. | M | High: write isolation | High behavior; medium latency attribution | `apps/web/lib/app-sync-service.ts:204`, `:301`, `:331`; `apps/web/lib/db/finance-db.ts:5252` |
| 02 | Full evidence rematch scales multiplicatively / performance | Every source item is compared with every transaction, plus serial mutations and semantic refresh queries. At this ledger size each eligible source item can score 6,697 transactions. | M–L | High: match equivalence | High algorithm; medium latency attribution | `apps/web/lib/db/finance-db.ts:3444`, `:6583`, `:7298`, `:8062` |
| 03 | Scheduled work repeats a provider / performance | A due SnapTrade run is followed by whole-app sync, which invokes SnapTrade again. This sequence appeared in logs. | S–M | Medium: claim/run accounting | High | `apps/web/lib/sync-schedule-ticker.ts:52`; `apps/web/lib/app-sync-service.ts:160` |
| 04 | Unrelated writes evict both finance caches / performance | Every queued write evicts shell/full-ledger data. Misses reload all transactions and balance snapshots; concurrent misses are not coalesced. | M | Medium: stale financial data | High behavior; medium contribution | `apps/web/lib/db/finance-db.ts:5258`, `:2613`; `apps/web/lib/finance-data.ts:91`, `:174` |
| 05 | Duplicate auth before shell rendering / performance | Proxy validates a page, root layout validates it again, then awaits shell reads. Observed proxy costs were 1.1–4.4 s; no per-auth-query trace collected. | M | High: authorization boundary | High duplication; medium attribution | `apps/web/proxy.ts:34`; `apps/web/app/layout.tsx:99`, `:133`; `apps/web/lib/auth.ts:102`, `:160` |
| 06 | Initial transaction route still loads full ledger / performance | Two full filtering passes happen before slicing two 200-row windows. Dashboard also loads the full snapshot for aggregates. | L | High: filters/counts/overlays | High behavior; medium contribution | `apps/web/app/transactions/page.tsx:18`, `:28`, `:47`; `apps/web/app/page.tsx:12`; `apps/web/lib/db/finance-db.ts:2620` |
| 07 | Closed overlays and chart dependency graph are eager / frontend | Agent/search code enters the shell before opening; charts statically import the Recharts wrapper despite per-export dynamic imports. Adds script loading and hydration work, but cannot explain 89 s before the first byte. | M | Medium: focus/deep links/layout | High graph; production size unmeasured | `apps/web/components/app-shell.tsx:28`, `:463`; `apps/web/components/agent-panel-provider.tsx:5`, `:551`; `apps/web/components/charts.tsx:6`; `apps/web/components/ui/charts.tsx:6` |
| 08 | Settings loads data/code for inactive tabs / performance | A single Promise.all waits for 12 data/status operations and all panels are statically imported. Default Connections depends on work for other tabs. | M–L | Medium: tab state | High code; route timing unmeasured | `apps/web/app/settings/page.tsx:34`; `apps/web/components/settings-view.tsx:3`, `:110` |
| 09 | Global conversation request is unbounded / performance | Every shell mount requests all conversation summaries; SQL has no LIMIT and API always reports has_more=false. Log showed a 5 s request, without component attribution. | M | Medium: pagination contract | High behavior; scale impact unmeasured | `apps/web/components/agent-panel-provider.tsx:71`; `apps/web/app/api/v1/conversations/route.ts:14`; `apps/web/lib/db/finance-db.ts:1441` |
| 10 | Recurring grouping repeatedly copies arrays / performance | An account/merchant bucket with k transactions performs quadratic element copying before detection. Secondary optimization. | S | Low | High complexity; current cost unmeasured | `apps/web/lib/finance-data.ts:504`, `:518` |
| 11 | CI omits the runtime combination that stalled / testing | Browser tests disabled in CI; local E2E uses dev + PGlite with scheduler disabled. Postgres integration is conditional. Timeout test checks an error result, not whether abandoned work stops. | M | Low | High | `.github/workflows/ci.yml:29`; `apps/web/playwright.config.ts:11`; `apps/web/__tests__/pg-driver.test.ts:15`; `apps/web/__tests__/app-sync-effect.test.ts:8` |

## Recommended correction boundaries and acceptance criteria

1. **Stop overlapping abandoned work first (01).** Give jobs explicit cancellation/ownership; do not release queue ownership or retry until the old writer has stopped or rolled back. Use a deterministic delayed-writer test proving a timeout never permits overlap. Raising the timeout alone is insufficient.
2. **Reduce and batch rematching (02), then coalesce schedules (03).** Reuse unchanged matches and bulk-read/write affected semantic data. Candidate pruning must prove winner equivalence against the existing matcher; date-only cutoffs could alter current matching semantics. Changed transactions as well as changed source items must invalidate affected matches. Preserve accepted/dismissed links. Test both schedules due, claim advancement and exactly one provider run.
3. **Protect cheap reads (04–06).** Classify invalidation by data dependency, share in-flight reads, batch overlay reads, and add bounded route projections. Preserve auth checks, overlay freshness, money signs, review counts and cursor behavior. Never trust a client-supplied auth marker or remove auth to improve timing. Give auth and finance pools explicit connection/query budgets.
4. **Reduce optional UI work (07–10) after server stability.** Load complete chart renderers and heavy overlays at meaningful boundaries; split Settings data by active tab; paginate conversation summaries. Preserve focus, deep links and chart layout. Replace recurring bucket copying with mutation of locally owned arrays, keeping output equivalent.
5. **Add regression evidence (11) alongside each fix.** Use an isolated test database and production-mode authenticated browser smoke with controlled background work. Measure TTFB, event-loop delay, query counts, cold/warm loads and production script sizes. Tests must observe cancellation and ownership, not just a returned timeout error.

Existing verification commands: `pnpm --dir apps/web exec tsc --noEmit`, `pnpm --dir apps/web test`, `pnpm --dir apps/web build`, `pnpm --dir apps/web test:e2e`. These were inspected, not run during this read-only audit. Production serving needs the configured `.next-build` directory and a separate fixture database; do not start another server on the default PGlite directory.

Recommended implementation-plan selection: 01, 02, 03 and 04, with targeted tests from 11 embedded in each. Implement cancellation/ownership before increasing job concurrency. Auth/read projections and frontend work can follow after the overload is controlled.

## Considered, corrected or rejected

- **Development mode alone:** rejected as sufficient explanation. Server application time dominates the logged slow requests. Development does add compile/debug overhead; see [Next.js development guidance](https://nextjs.org/docs/app/guides/local-development).
- **PGlite single-handle blocking:** rejected for this live instance. Postgres is configured, and its driver normally sends unrelated reads to the pool (`apps/web/lib/db/pg-driver.ts:59`). Queue occupancy alone does not prove page-read blocking.
- **Concurrent SnapTrade and whole-app ticker jobs:** corrected. They run sequentially in one tick; duplicate provider work remains real. Abandoned Promise work is a separate overlap mechanism.
- **Missing virtualization or cache:** rejected. Both exist; initial server materialization and invalidation are the problems.
- **Animation as the primary delay:** rejected. Paint/animation cannot explain the measured wait before the server sends a byte. Whole-page blur remains an unprofiled secondary candidate.
- **Old performance plans mean fixes are on this branch:** rejected. `.agent/advisor-plans/README.md` marks chart/overlay and bounded-read work DONE, but cited commit `7cef9c1` is not an ancestor of current HEAD. Reconcile that work before writing replacement plans; do not label this a verified regression from that commit.
- **Dev script bytes equal production bundle size:** rejected. The production build artifact is stale and was not rebuilt.

## Limits

No source edits, installs, builds, tests, database queries, provider sync triggers, service restarts or browser setting changes were performed for this audit. Existing scheduled work continued in the running app. One browser reload was requested; browser inspection was reconnected after timeouts. Network capture was disabled afterward.

Performance-focused inspection covered the web server, data boundary, scheduler/auth, primary frontend routes and existing test configuration. Shared package/runtime context was reviewed; iOS behavior, every provider's internals, security posture and product direction were not deeply audited. No SQL execution plans, database latency sample, CPU flamegraph or isolated production benchmark was collected. Host contention and concurrent source edits limit causal precision. No claim of a proven production speedup is made.
