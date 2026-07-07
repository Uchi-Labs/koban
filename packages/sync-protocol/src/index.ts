import type {
  Account,
  ProviderConnection,
  ProviderId,
  ProviderStatus,
  Transaction,
} from "@ai-finances/schema";

export interface TellerAdapterConfig {
  provider: "teller";
  applicationId?: string;
  certificatePath?: string;
  privateKeyPath?: string;
  enrollmentAccessTokenEnvVar?: string;
  hasEnrollmentAccessToken?: boolean;
  environment?: "sandbox" | "development" | "production";
}

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
  TELLER_APPLICATION_ID?: string;
  TELLER_CERTIFICATE_PATH?: string;
  TELLER_PRIVATE_KEY_PATH?: string;
  TELLER_TOKEN_SIGNING_PUBLIC_KEY?: string;
  TELLER_ACCESS_TOKEN?: string;
  TELLER_ENROLLMENT_ACCESS_TOKEN?: string;
  TELLER_ENROLLMENTS_B64?: string;
  TELLER_ENROLLMENT_ID?: string;
  TELLER_USER_ID?: string;
  TELLER_API_VERSION?: string;
  TELLER_SYNC_START_DATE?: string;
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

export function getTellerStatusFromEnv(env: ProviderEnv = {}): ProviderStatus {
  return hasTellerConfig(env) ? "connected" : "not_configured";
}

function hasTellerConfig(env: ProviderEnv): boolean {
  return Boolean(
      env.TELLER_APPLICATION_ID &&
      env.TELLER_CERTIFICATE_PATH &&
      env.TELLER_PRIVATE_KEY_PATH &&
      (env.TELLER_ACCESS_TOKEN || env.TELLER_ENROLLMENT_ACCESS_TOKEN),
  );
}
