"use client";

import Link from "next/link";
import { useEffect } from "react";
import { pageFrameClassName } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";

// Without this boundary a thrown render error shows Next's bare error screen
// with no way back into the app.
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={pageFrameClassName}>
      <EmptyState
        actions={
          <>
            <Button onClick={() => retry()} type="button">
              Try again
            </Button>
            <Link className={buttonVariants({ variant: "outline" })} href="/">
              Back to dashboard
            </Link>
          </>
        }
        description={
          error.digest
            ? `Loading it again often works. If it keeps failing, the server logs have the details (reference ${error.digest}).`
            : "Loading it again often works. If it keeps failing, the server logs have the details."
        }
        role="alert"
        title="This page couldn't load"
      />
    </main>
  );
}
