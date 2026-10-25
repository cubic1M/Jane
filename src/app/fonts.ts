import { Playfair_Display } from "next/font/google";

// The display face for the landing page's biggest words (founder, 2026-10-24: Agraham, by Hishand
// Studio). Agraham is a commercial font (the free download is personal use only; a licence is
// about $6 a style on MyFonts), so until it's bought this is Playfair Display, the closest free
// high-contrast display serif. globals.css puts "Agraham" first in --font-display.
//
// next/font/local fails the build when its file is missing, so it's wired once the licensed file
// is at public/fonts/agraham.woff2: replace this with
//   import localFont from "next/font/local";
//   export const displayFont = localFont({
//     src: "../../public/fonts/agraham.woff2",
//     variable: "--font-display-face",
//     display: "swap",
//   });
export const displayFont = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
});
