import type { PlaidSetupStatus } from "@/lib/plaid-server";

export function serializePlaidStatus(status: PlaidSetupStatus) {
  return {
    client_id_configured: status.clientIdConfigured,
    configured: status.configured,
    environment: status.environment,
    item_count: status.itemCount,
    items: status.items.map((item) => ({
      object: "plaid_item",
      account_count: item.accountCount,
      accounts: item.accounts.map((account) => ({
        currency: account.currency,
        current_balance: account.currentBalance,
        id: account.id,
        mask: account.mask,
        name: account.name,
        type: account.type
      })),
      cursor_present: item.cursorPresent,
      error_message: item.errorMessage,
      id: item.id,
      institution_id: item.institutionId,
      institution_name: item.institutionName,
      last_synced_at: item.lastSyncedAt,
      status: item.status,
      transaction_count: item.transactionCount
    })),
    last_synced_at: status.lastSyncedAt,
    ready_for_link: status.readyForLink,
    ready_for_sync: status.readyForSync,
    redirect_uri_configured: status.redirectUriConfigured,
    secret_configured: status.secretConfigured,
    standby_institution_names: status.standbyInstitutionNames,
    stored_account_count: status.storedAccountCount,
    stored_transaction_count: status.storedTransactionCount
  };
}
