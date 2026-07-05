import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = firstParam(params.next) ?? "/";
  const invalid = firstParam(params.error) === "1";

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <form
        action="/api/login"
        method="post"
        className="grid w-full max-w-sm gap-5 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <input type="hidden" name="next" value={nextPath} />
        <div className="grid gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LogIn className="size-4" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-normal">Sign in</h1>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="token">Access token</Label>
          <Input id="token" name="token" type="password" autoComplete="current-password" required autoFocus />
          {invalid ? <p className="text-sm text-destructive">Token was not accepted.</p> : null}
        </div>
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
