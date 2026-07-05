import type { MetadataRoute } from "next";

const themeColor = "#07090b";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: themeColor,
    description: "Teller-backed personal finance app",
    display: "standalone",
    icons: [
      {
        sizes: "192x192",
        src: "/icons/icon-192.png",
        type: "image/png"
      },
      {
        sizes: "512x512",
        src: "/icons/icon-512.png",
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
    name: "AI Finances",
    scope: "/",
    short_name: "Finances",
    start_url: "/",
    theme_color: themeColor
  };
}
