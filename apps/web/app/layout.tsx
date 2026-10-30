import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { AgentationDev } from "@/components/agentation-dev";
import { AppShell } from "@/components/app-shell";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { Toaster } from "@/components/ui/sonner";
import { authenticateApiRequest } from "@/lib/auth";
import { ACCENT_COOKIE, accentStyle, parseAccent } from "@/lib/accent-color";
import { getShellData } from "@/lib/finance-data";
import { FONT_CHOICE_COOKIE, fontChoiceStyle, parseFontChoice } from "@/lib/font-choice";
import { MONEY_COLORS_COOKIE, moneyColorStyle, parseMoneyColors } from "@/lib/money-colors";
import { parseSidebarWidth, SIDEBAR_WIDTH_COOKIE } from "@/lib/sidebar-width";
import { parseUiMode, UI_MODE_COOKIE } from "@/lib/ui-mode";
import "./shadcn.css";
import "./globals.css";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import { selectableFontVariables } from "./fonts";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// Quiet register faces. Self-hosted variable woff2 (~84KB for both, covering
// every weight), following the reference codebases, which use next/font/local
// throughout rather than next/font/google. Both are ITF Free Font License;
// the license texts sit beside the files in app/fonts/.
//
// These only take effect under <html data-ui="quiet"> — see app/quiet.css.
// Ink & Mint keeps Inter.
// preload:false is deliberate. Only [data-ui="quiet"] references these, so
// preloading would make every Ink & Mint page fetch 84KB of fonts nothing on
// the page uses. They load on demand when the quiet register is active.
const satoshi = localFont({
  src: "./fonts/Satoshi-Variable.woff2",
  variable: "--font-quiet-sans",
  weight: "300 900",
  display: "swap",
  preload: false
});

const cabinetGrotesk = localFont({
  src: "./fonts/CabinetGrotesk-Variable.woff2",
  variable: "--font-quiet-display",
  weight: "100 900",
  display: "swap",
  preload: false
});

const quietFonts = cn(satoshi.variable, cabinetGrotesk.variable, selectableFontVariables);
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
  const cookieStore = await cookies();
  const theme = cookieStore.get("koban_theme")?.value === "light" ? "light" : "dark";
  // Read server-side so the correct design renders on first paint, with no
  // flash of the other one. See lib/ui-mode.ts — migration scaffolding.
  const uiMode = parseUiMode(cookieStore.get(UI_MODE_COOKIE)?.value);
  // Chosen money colours and typeface, merged into one inline style so they
  // outrank both design registers and land on the first paint. Each contributes
  // nothing at its default, and the whole style is dropped when neither has been
  // touched, leaving the stylesheets authoritative on a stock install.
  const overrides = {
    ...moneyColorStyle(parseMoneyColors(cookieStore.get(MONEY_COLORS_COOKIE)?.value)),
    ...fontChoiceStyle(parseFontChoice(cookieStore.get(FONT_CHOICE_COOKIE)?.value)),
    ...accentStyle(parseAccent(cookieStore.get(ACCENT_COOKIE)?.value))
  };
  const rootStyle = Object.keys(overrides).length > 0 ? overrides : undefined;
  // Read here rather than from localStorage in the client, so the sidebar
  // renders at its saved width on the server and hydration has nothing to
  // disagree about.
  const sidebarWidth = parseSidebarWidth(cookieStore.get(SIDEBAR_WIDTH_COOKIE)?.value);
  const shouldRenderShell = await isShellRequestAuthenticated();

  const shellData = shouldRenderShell ? await getShellData() : null;

  return (
    <html
      lang="en"
      data-ui={uiMode}
      className={cn(theme === "dark" && "dark", "font-sans", inter.variable, quietFonts)}
      style={rootStyle}
    >
      <body className="antialiased">
        <PwaServiceWorker />
        {shellData ? (
          <AppShell
            accounts={shellData.accounts}
            accountGroups={shellData.accountGroups}
            demoMode={shellData.demoMode}
            initialSidebarWidth={sidebarWidth}
            lastSyncedAt={shellData.lastSyncedAt}
            reviewActionableCount={shellData.reviewActionableCount}
            source={shellData.source}
            transactionCount={shellData.transactionCount}
          >
            {children}
          </AppShell>
        ) : children}
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
