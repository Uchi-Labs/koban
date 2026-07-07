import type { MetadataRoute } from "next";

const themeColor = "#07090b";

type IconEnvironment = "production" | "staging" | "local";

function iconEnvironment(): IconEnvironment {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();

  if (appEnv === "production") {
    return "production";
  }

  if (appEnv === "staging" || appEnv === "develop" || appEnv === "development-remote") {
    return "staging";
  }

  return "local";
}

const iconSetByEnvironment: Record<IconEnvironment, { label: string; prefix: string }> = {
  local: { label: "Koban (local)", prefix: "/icons/koban-local" },
  production: { label: "Koban", prefix: "/icons/icon" },
  staging: { label: "Koban (staging)", prefix: "/icons/koban-staging" }
};

export default function manifest(): MetadataRoute.Manifest {
  const environment = iconEnvironment();
  const iconSet = iconSetByEnvironment[environment];

  return {
    background_color: themeColor,
    description: "Koban — your personal finance ledger, all accounts in one place.",
    display: "standalone",
    icons: [
      {
        sizes: "192x192",
        src: `${iconSet.prefix}-192.png`,
        type: "image/png"
      },
      {
        sizes: "512x512",
        src: `${iconSet.prefix}-512.png`,
        type: "image/png"
      },
      {
        purpose: "maskable",
        sizes: "192x192",
        src: "/icons/maskable-icon-192.png",
        type: "image/png"
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: "/icons/maskable-icon-512.png",
        type: "image/png"
      }
    ],
    id: "/",
    name: iconSet.label,
    scope: "/",
    short_name: "Koban",
    start_url: "/",
    theme_color: themeColor
  };
}
