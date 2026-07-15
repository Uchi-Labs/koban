import Link from "next/link";

const sections = [
  {
    title: "Who Uses This Instance",
    body: [
      "Koban is a self-hosted, single-operator personal finance app. The only user of this instance is the instance owner."
    ]
  },
  {
    title: "Data Collected",
    body: [
      "When the owner explicitly connects a financial institution, Koban stores account metadata, balances, and transactions from Teller, Plaid, SnapTrade, and SimpleFIN. These connections are read-only."
    ]
  },
  {
    title: "Storage And Sharing",
    body: [
      "Financial data is stored in the owner's own PostgreSQL database, either on the owner's local machine or in the owner's Railway project.",
      "Koban does not sell this data, share it for advertising, or transmit it to unrelated third parties. The app sends data only to the connected data providers needed for the owner's authorized connections and syncs.",
      "AI enrichment is off by default with AI_FINANCES_LLM_PROVIDER=none. If the owner explicitly configures AI enrichment, selected transaction and context data may be sent to the configured LLM provider."
    ]
  },
  {
    title: "Consent",
    body: [
      "Connecting an institution is an explicit owner action through that provider's consent flow, such as Plaid Link, Fidelity Access, SimpleFIN Bridge, SnapTrade, or Teller Connect."
    ]
  },
  {
    title: "Retention And Deletion",
    body: [
      "Koban retains synced data while a connection is active. The owner can delete local app data at any time from Settings using the local-data reset flow.",
      "The owner can also revoke provider access at the provider or institution, including Plaid Portal, SimpleFIN Bridge, the SnapTrade dashboard, and Teller."
    ]
  },
  {
    title: "Contact",
    body: [
      "For this personal instance, contact the instance operator at vishhvaks@gmail.com."
    ]
  }
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 text-foreground sm:px-6 sm:py-10">
      <header className="grid gap-3 border-b border-border pb-6">
        <Link className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline" href="/">
          Back to Koban
        </Link>
        <div className="grid gap-2">
          <h1 className="app-page-title">Koban Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Effective date: July 6, 2026</p>
        </div>
      </header>

      <article className="grid gap-7">
        {sections.map((section) => (
          <section className="grid gap-2" key={section.title}>
            <h2 className="text-base font-medium">{section.title}</h2>
            <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
              {section.body.map((paragraph) => (
                <p key={paragraph}>
                  {paragraph === "For this personal instance, contact the instance operator at vishhvaks@gmail.com." ? (
                    <>
                      For this personal instance, contact the instance operator at{" "}
                      <a className="text-foreground underline-offset-4 hover:underline" href="mailto:vishhvaks@gmail.com">
                        vishhvaks@gmail.com
                      </a>
                      .
                    </>
                  ) : (
                    paragraph
                  )}
                </p>
              ))}
            </div>
          </section>
        ))}
      </article>
    </main>
  );
}
