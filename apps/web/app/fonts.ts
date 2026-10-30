import { Alegreya_Sans, Averia_Serif_Libre, Crimson_Pro, Space_Mono } from "next/font/google";
import localFont from "next/font/local";

/**
 * Selectable typefaces for the appearance settings.
 *
 * Kept out of layout.tsx because that file's job is the document shell, and
 * this is a catalogue that will keep growing. Every face here is self-hosted:
 * the local ones from app/fonts/, and the Google ones through next/font/google,
 * which downloads and serves them from this origin at build time. That is a
 * requirement, not a preference, since the CSP allows `font-src 'self' data:`
 * (next.config.ts) and a third-party webfont host would simply be blocked.
 *
 * Every face is `preload: false`, written out in each call rather than shared
 * from one object: next/font loaders are parsed statically at build time and
 * reject a spread outright ("Unexpected spread"). Only one pairing is ever active, so
 * preloading would make each page fetch a megabyte of fonts it will not use.
 * The browser fetches a face the moment something on the page asks for it.
 *
 * Licences live beside the files. The Fontshare families (Gambetta, Bespoke
 * Sans, Synonym, Amulya, Tabular, Azeret Mono, Sora, Lora, Karma, Nunito, Work
 * Sans, Satoshi, Cabinet Grotesk) share one ITF Free Font License, recorded in
 * LICENSE-Fontshare-ITF-FFL.txt. Averia Serif Libre, Space Mono, Crimson Pro
 * and Alegreya Sans are Open Font License via Google Fonts.
 *
 * APERCU IS DIFFERENT AND DELIBERATE: it is a commercial Colophon Foundry face
 * copied from another local project, with no webfont licence in this repo.
 * Fine for a private self-hosted install, not something to ship publicly
 * without buying the licence. Clarendon and Munson come from the personal site
 * repo and carry no licence text either.
 */

// ── Fontshare, variable: one file covers every weight ────────────────────────

const gambetta = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Gambetta-Variable.woff2",
  variable: "--font-gambetta",
  weight: "300 700"
});

const bespokeSans = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/BespokeSans-Variable.woff2",
  variable: "--font-bespoke-sans",
  weight: "100 900"
});

const synonym = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Synonym-Variable.woff2",
  variable: "--font-synonym",
  weight: "100 900"
});

const amulya = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Amulya-Variable.woff2",
  variable: "--font-amulya",
  weight: "100 900"
});

const tabular = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Tabular-Variable.woff2",
  variable: "--font-tabular",
  weight: "100 900"
});

const azeretMono = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/AzeretMono-Variable.woff2",
  variable: "--font-azeret-mono",
  weight: "100 900"
});

const sora = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Sora-Variable.woff2",
  variable: "--font-sora",
  weight: "100 800"
});

const lora = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Lora-Variable.woff2",
  variable: "--font-lora",
  weight: "400 700"
});

const karma = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Karma-Variable.woff2",
  variable: "--font-karma",
  weight: "300 700"
});

const nunito = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Nunito-Variable.woff2",
  variable: "--font-nunito",
  weight: "200 1000"
});

const workSans = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/WorkSans-Variable.woff2",
  variable: "--font-work-sans",
  weight: "100 900"
});

// ── Local statics from other projects on this machine ────────────────────────

const apercu = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Apercu-Regular.otf",
  variable: "--font-apercu",
  weight: "400"
});

const apercuMono = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Apercu-Mono.otf",
  variable: "--font-apercu-mono",
  weight: "400"
});

const clarendon = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Clarendon-Regular.woff",
  variable: "--font-clarendon",
  weight: "400"
});

const munson = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Munson-Regular.otf",
  variable: "--font-munson",
  weight: "400"
});

// ── Google, self-hosted by next/font at build time ───────────────────────────

const averiaSerifLibre = Averia_Serif_Libre({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-averia",
  weight: ["300", "400", "700"]
});

const spaceMono = Space_Mono({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"]
});

const crimsonPro = Crimson_Pro({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-crimson-pro"
});

const alegreyaSans = Alegreya_Sans({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-alegreya-sans",
  weight: ["400", "500", "700"]
});

/**
 * Every variable class, for the <html> element.
 *
 * A class only declares the custom property; it does not load anything. The
 * fetch happens when a rule actually resolves to that family, so carrying all
 * of them costs nothing until one is chosen.
 */
export const selectableFontVariables = [
  alegreyaSans.variable,
  amulya.variable,
  apercu.variable,
  apercuMono.variable,
  averiaSerifLibre.variable,
  azeretMono.variable,
  bespokeSans.variable,
  clarendon.variable,
  crimsonPro.variable,
  gambetta.variable,
  karma.variable,
  lora.variable,
  munson.variable,
  nunito.variable,
  sora.variable,
  spaceMono.variable,
  synonym.variable,
  tabular.variable,
  workSans.variable
].join(" ");
