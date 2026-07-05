import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { authCookieName, getBearerToken, getConfiguredAuthToken } from "@/lib/auth";
import { timingSafeTokenEquals } from "@/lib/auth-node";
import { getShellData } from "@/lib/finance-data";
import "./shadcn.css";
import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});
const pwaThemeColor = "#07090b";

export const metadata: Metadata = {
  applicationName: "AI Finances",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Finances"
  },
  title: "AI Finances",
  description: "Teller-backed personal finance app",
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  },
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  colorScheme: "dark",
  initialScale: 1,
  themeColor: pwaThemeColor,
  viewportFit: "cover",
  width: "device-width"
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const shouldRenderShell = await isShellRequestAuthenticated();

  if (!shouldRenderShell) {
    return (
      <html lang="en" className={cn("dark font-sans", inter.variable)}>
        <body>
          <PwaServiceWorker />
          {children}
        </body>
      </html>
    );
  }

  const shellData = await getShellData();

  return (
    <html lang="en" className={cn("dark font-sans", inter.variable)}>
      <body>
        <PwaServiceWorker />
        <AppShell
          accounts={shellData.accounts}
          accountGroups={shellData.accountGroups}
          lastSyncedAt={shellData.lastSyncedAt}
          source={shellData.source}
          transactionCount={shellData.transactionCount}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}

async function isShellRequestAuthenticated(): Promise<boolean> {
  const expectedToken = getConfiguredAuthToken();

  if (!expectedToken) {
    return true;
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const sessionToken = cookieStore.get(authCookieName)?.value;
  const bearerToken = getBearerToken(headerStore.get("authorization"));

  return timingSafeTokenEquals(sessionToken, expectedToken) || timingSafeTokenEquals(bearerToken, expectedToken);
}
