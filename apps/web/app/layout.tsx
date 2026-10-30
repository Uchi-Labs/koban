import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { AgentationDev } from "@/components/agentation-dev";
import { AppShell } from "@/components/app-shell";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { Toaster } from "@/components/ui/sonner";
import { authenticateApiRequest } from "@/lib/auth";
import { isPublicDemo } from "@/lib/public-demo";
import { getShellData } from "@/lib/finance-data";
import "./shadcn.css";
import "./globals.css";
import localFont from "next/font/local";
import { cn } from "@/lib/utils";

// Apercu Pro ships no semibold, so medium also answers 600 (font-semibold)
// instead of the browser falling through to bold.
const apercu = localFont({
  display: "swap",
  src: [
    { path: "./fonts/apercu/apercu-pro-regular.woff2", style: "normal", weight: "400" },
    { path: "./fonts/apercu/apercu-pro-regular-italic.woff2", style: "italic", weight: "400" },
    { path: "./fonts/apercu/apercu-pro-medium.woff2", style: "normal", weight: "500 600" },
    { path: "./fonts/apercu/apercu-pro-medium-italic.woff2", style: "italic", weight: "500 600" },
    { path: "./fonts/apercu/apercu-pro-bold.woff2", style: "normal", weight: "700 900" },
    { path: "./fonts/apercu/apercu-pro-bold-italic.woff2", style: "italic", weight: "700 900" }
  ],
  variable: "--font-sans"
});
const pwaThemeColor = "#07090b";

export const metadata: Metadata = {
  applicationName: "Koban",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Koban"
  },
  title: "Koban",
  description: "Private personal finance app",
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
  // A visitor's own toggle wins; otherwise the public demo opens in light mode.
  const themeCookie = (await cookies()).get("koban_theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : isPublicDemo() ? "light" : "dark";
  const shouldRenderShell = await isShellRequestAuthenticated();

  if (!shouldRenderShell) {
    return (
      <html data-public-demo={isPublicDemo() ? "" : undefined} lang="en" className={cn(theme === "dark" && "dark", "font-sans", apercu.variable)}>
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
    <html data-public-demo={isPublicDemo() ? "" : undefined} lang="en" className={cn(theme === "dark" && "dark", "font-sans", apercu.variable)}>
      <body className="antialiased">
        <PwaServiceWorker />
        <AppShell
          accounts={shellData.accounts}
          accountGroups={shellData.accountGroups}
          demoMode={shellData.demoMode}
          lastSyncedAt={shellData.lastSyncedAt}
          publicDemo={isPublicDemo()}
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
