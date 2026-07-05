import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page page-settings">
      <div className="page-title">Not found</div>
      <section className="settings-panel">
        <h1>Nothing here yet</h1>
        <p>The implemented app surfaces are Dashboard, Transactions, Accounts, Categories, Recurrings, Rules, Search, Agent, and Settings.</p>
        <Link className="secondary-button inline-button" href="/">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
