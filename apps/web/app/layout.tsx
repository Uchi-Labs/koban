import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { AgentationDev } from "@/components/agentation-dev";
import { AppShell } from "@/components/app-shell";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { Toaster } from "@/components/ui/sonner";
import { authenticateApiRequest } from "@/lib/auth";
import { getShellData } from "@/lib/finance-data";
import "./shadcn.css";
import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const pwaThemeColor = "#07090b";

export const metadata: Metadata = {
  applicationName: "Koban",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Koban"
  },
  title: "Koban",
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
  colorScheme: "light dark",
  initialScale: 1,
  themeColor: pwaThemeColor,
  viewportFit: "cover",
  width: "device-width"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("koban_theme")?.value === "light" ? "light" : "dark";
  const shouldRenderShell = await isShellRequestAuthenticated();

  if (!shouldRenderShell) {
    return (
      <html lang="en" className={cn(theme === "dark" && "dark", "font-sans", inter.variable)}>
        <body className="antialiased">
          <PwaServiceWorker />
          {children}
          <Toaster />
          <AgentationDev />
        </body>
      </html>
    );
  }

  const shellData = await getShellData();

  return (
    <html lang="en" className={cn(theme === "dark" && "dark", "font-sans", inter.variable)}>
      <body className="antialiased">
        <PwaServiceWorker />
        <AppShell
          accounts={shellData.accounts}
          accountGroups={shellData.accountGroups}
          demoMode={shellData.demoMode}
          lastSyncedAt={shellData.lastSyncedAt}
          reviewActionableCount={shellData.reviewActionableCount}
          source={shellData.source}
          transactionCount={shellData.transactionCount}
        >
          {children}
        </AppShell>
        <Toaster />
        <AgentationDev />
      </body>
    </html>
  );
}

async function isShellRequestAuthenticated(): Promise<boolean> {
  const headerStore = await headers();
  const result = await authenticateApiRequest(new Request("http://shell.internal/", { headers: headerStore }));
  return result.authenticated;
}
