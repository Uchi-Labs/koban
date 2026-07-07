import type { SnapTradeSetupStatus } from "@/lib/snaptrade-server";

export function serializeSnapTradeStatus(status: SnapTradeSetupStatus) {
  return {
    client_id_configured: status.clientIdConfigured,
    configured: status.configured,
    connection_count: status.connectionCount,
    connections: status.connections.map((connection) => ({
      object: "snaptrade_connection",
      account_count: connection.accountCount,
      accounts: connection.accounts.map((account) => ({
        currency: account.currency,
        current_balance: account.currentBalance,
        id: account.id,
        mask: account.mask,
        name: account.name,
        type: account.type
      })),
      brokerage_name: connection.brokerageName,
      created_at: connection.createdAt,
      disabled: connection.disabled,
      error_message: connection.errorMessage,
      id: connection.id,
      last_synced_at: connection.lastSyncedAt,
      name: connection.name,
      status: connection.status,
      type: connection.type
    })),
    consumer_key_configured: status.consumerKeyConfigured,
    error_message: status.errorMessage,
    last_synced_at: status.lastSyncedAt,
    ready_for_connect: status.readyForConnect,
    ready_for_sync: status.readyForSync,
    registered: status.registered,
    stored_account_count: status.storedAccountCount,
    stored_position_count: status.storedPositionCount
  };
}
