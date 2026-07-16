import type {
  Account,
  ProviderConnection,
  ProviderId,
  ProviderStatus,
  Transaction,
} from "@ai-finances/schema";

export interface SnapTradeAdapterConfig {
  provider: "snaptrade";
  clientId?: string;
  hasConsumerKey?: boolean;
}

export interface SimpleFinAdapterConfig {
  provider: "simplefin";
  accessUrlEnvVar?: string;
  hasAccessUrl?: boolean;
}

export interface PlaidAdapterConfig {
  provider: "plaid";
  clientId?: string;
  environment?: "sandbox" | "development" | "production";
  hasSecret?: boolean;
}

export interface FinanceKitAdapterConfig {
  provider: "financekit";
  endpointUrl?: string;
  hasBearerToken?: boolean;
}

export interface ProviderSyncResult {
  providerConnection: ProviderConnection;
  accounts: Account[];
  transactions: Transaction[];
  syncedAt: string;
}

export interface ProviderAdapter<
  TProvider extends ProviderId = ProviderId,
  TConfig = unknown,
> {
  readonly provider: TProvider;
  readonly displayName: string;
  getStatus(config: TConfig): ProviderStatus;
  sync(config: TConfig): Promise<ProviderSyncResult>;
}

export interface ProviderEnv {
  SNAPTRADE_CLIENT_ID?: string;
  SNAPTRADE_CONSUMER_KEY?: string;
  SIMPLEFIN_ACCESS_URL?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_SANDBOX_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_ITEMS_B64?: string;
  PLAID_REDIRECT_URI?: string;
}

