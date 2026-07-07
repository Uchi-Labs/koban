import type { SimpleFinSetupStatus } from "@/lib/simplefin-server";

export function serializeSimpleFinStatus(status: SimpleFinSetupStatus) {
  return {
    access_url_configured: status.accessUrlConfigured,
    configured: status.configured,
    connection_count: status.connectionCount,
    connections: status.connections.map((connection) => ({
      object: "simplefin_connection",
      account_count: connection.accountCount,
      accounts: connection.accounts.map((account) => ({
        balance_as_of: account.balanceAsOf,
        currency: account.currency,
        current_balance: account.currentBalance,
        id: account.id,
        name: account.name,
        standby: account.standby,
        type: account.type
      })),
      error_message: connection.errorMessage,
      id: connection.id,
      last_synced_at: connection.lastSyncedAt,
      name: connection.name,
      status: connection.status,
      transaction_count: connection.transactionCount
    })),
    last_errors: status.lastErrors,
    last_synced_at: status.lastSyncedAt,
    latest_balance_as_of: status.latestBalanceAsOf,
    ready_for_sync: status.readyForSync,
    stored_account_count: status.storedAccountCount,
    stored_transaction_count: status.storedTransactionCount
  };
}
