import { Playfair_Display } from "next/font/google";

// The display face for the landing page's biggest words (founder, 2026-10-26: Orange Avenue, by
// Ratna Krismawati). The free "DEMO" is for personal use only; a site needs the commercial
// licence. Until it's bought this is Playfair Display, the closest free high-contrast display
// serif. globals.css puts "Orange Avenue" first in --font-display, so a copy installed on the
// viewer's computer wins.
//
// next/font/local fails the build when its file is missing, so it's wired once the licensed file
// is at public/fonts/orange-avenue.woff2: replace this with
//   import localFont from "next/font/local";
//   export const displayFont = localFont({
//     src: "../../public/fonts/orange-avenue.woff2",
//     variable: "--font-display-face",
//     display: "swap",
//   });
export const displayFont = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
});
