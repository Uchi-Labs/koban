import { PlaidConnectSetup } from "@/components/plaid-connect-setup";
import { getPlaidSetupStatus } from "@/lib/plaid-server";

export default async function PlaidOauthReturnPage() {
  const status = await getPlaidSetupStatus();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <PlaidConnectSetup autoOpen initialStatus={structuredClone(status)} />
    </main>
  );
}
