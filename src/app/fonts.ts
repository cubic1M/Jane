import { Fraunces } from "next/font/google";

// The display face for the landing page's biggest words (founder, 2026-10-24: Aguero Serif).
// Aguero Serif is a commercial font (Craft Supply Co; the free download is personal use only),
// so until its licence is bought this is Fraunces, a free soft, high-contrast display serif,
// with its "soft" axis turned up. globals.css puts "Aguero Serif" first in --font-display.
//
// Once the licensed file is at public/fonts/aguero-serif.woff2, replace this with:
//   import localFont from "next/font/local";
//   export const displayFont = localFont({
//     src: "../../public/fonts/aguero-serif.woff2",
//     variable: "--font-display-face",
//     display: "swap",
//   });
export const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display-face",
  axes: ["SOFT", "opsz"],
  display: "swap",
});
