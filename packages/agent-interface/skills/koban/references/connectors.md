# Connectors

Connectors feed evidence (mail, orders) and transactions (banks). Readiness is reported honestly: a connector is ready only when a live check passes.

## Check

```sh
koban connectors status --verify          # table in a terminal; add --json for rows
koban connectors status gmail --verify    # one connector
koban sync status --json                  # bank providers: plaid, snaptrade, simplefin
```

Each mailbox is its own row: `gmail:<profile>`, `outlook:<profile>`, whose source ID is `source_gmail__<profile>` / `source_outlook_email__<profile>`. `koban connectors accounts` lists registered mailboxes. Ready means `live_access: verified`. `credentials_present` alone means a token file exists, not that it works.

Completion: every row has a verdict — ready, needs user login (with the exact command), or unusable for evidence (with the reason).

## Logins are the user's

Logins open a browser, a device code or a password prompt, so the user runs them. Give the exact command; in Claude Code the user types it with a `!` prefix so the output lands in the session. Rerun `status --verify` afterwards.

## Fixes by symptom

| Connector | Symptom | Fix |
|---|---|---|
| Gmail | `invalid_grant: Token has been expired or revoked` | `koban connectors login gmail --profile <profile>` (new mailbox: `--email ADDRESS`). Google expires these logins 7 days after sign-in while the OAuth consent screen (Google Cloud project `photos-500723`) is in Testing; publishing it to Production makes them last. Needs `GOG_KEYRING_PASSWORD`, exported from `~/.zshenv`. |
| Gmail | Live search reports rate limiting | Per-user quota is low: search mailboxes one at a time and skip that mailbox for the rest of the run. |
| Outlook | Verify fails | `koban connectors login outlook` (device code, read-only mail scopes). Koban refreshes tokens itself before every read. |
| Amazon | `Amazon Sign-In` / credentials invalid while Chrome shows you signed in | Amazon gates order history behind a fresh password. User opens `https://www.amazon.com/gp/css/order-history` in Chrome and enters the password, then runs `amazon-orders-pp-cli auth login --chrome`; success prints `Validating browser session... valid`. |
| Shop | Verify fails / sync says signed out | User signs in at `https://shop.app/account/order-history` in Chrome until orders show, then `koban connectors login shop --chrome`. |
| Instacart | `kooky could not read Chrome cookies: …/Default/Network/Cookies` | This Chrome stores cookies at `Default/Cookies`. Import directly: `pycookiecheat https://www.instacart.com \| python3 -c 'import json,sys; print("; ".join(f"{k}={v}" for k,v in json.load(sys.stdin).items()))' \| instacart-pp-cli auth paste` |
| Plaid / SnapTrade | Connection needs attention | Reconnect in the app's Settings (browser flow), then `koban sync run`. |

## Coverage limits

- **Instacart**: login verifies, but its CLI cannot download order history (`instacart-pp-cli history --help` says so). Orders come from Gmail receipts or the order-history page via `references/browser-evidence.md`.
- **Airbnb**: the CLI reads wishlists only, no trips or payments. Stays come from Gmail receipts or the trips page via `references/browser-evidence.md`.
- **Shop**: orders paid through Shop carry totals; Amazon orders Shop merely tracks have no price.
- **iCloud Mail**: needs an app-specific password file (`--password-file PATH`); not set up on this machine.
