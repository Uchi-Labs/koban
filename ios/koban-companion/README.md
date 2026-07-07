# Koban FinanceKit Companion

Native iOS companion scaffold for syncing Apple Card, Apple Cash, and Apple Savings data into Koban through `/api/v1/financekit/ingest`.

## Setup

1. Use a paid Apple Developer Program account.
2. Request the FinanceKit entitlement from Apple: https://developer.apple.com/contact/request/financekit
3. Install XcodeGen:

   ```bash
   brew install xcodegen
   ```

4. Generate the project:

   ```bash
   cd ios/koban-companion
   xcodegen generate
   ```

5. Open `KobanCompanion.xcodeproj` in Xcode.
6. Set your development team and replace the placeholder bundle ID `com.vishhvak.koban.companion` with the real bundle ID approved for FinanceKit.
7. Run on a physical iPhone. FinanceKit does not work in Simulator.
8. In the app settings, enter:
   - Server URL: `https://finances.vishhvak.com` or your local tunnel to Koban
   - Bearer token: the Koban instance token from `AI_FINANCES_AUTH_TOKEN`
9. Tap Sync.

Apple Card data exists only on the iPhone with the card provisioned. Apple Cash and Apple Savings access is also device and account dependent.

## Notes

- The entitlement file sets `com.apple.developer.financekit` to `["financial-data"]`.
- The Info.plist includes both `NSFinancialDataUsageDescription` from Apple's current documentation and `NSFinancialDataDescription` requested by this scaffold brief.
- This scaffold was written without building in Xcode. The installed SDK interface on this machine exposes `FinanceStore`, `AuthorizationStatus`, `AccountQuery`, `TransactionQuery`, `FinanceStore.HistoryToken`, `Account.accountDescription`, `Transaction.accountID`, and `Transaction.transactionAmount`. Confirm exact symbol availability against your installed SDK before shipping.
- Background refresh uses `BGAppRefreshTask`; iOS decides when it runs. Manual sync remains the primary path.
