import { Oswald } from "next/font/google";

// The display face for the landing page's biggest words (founder, 2026-10-26: Rules Gothic
// Condensed Light, "NMY Rules Gothic"). It is a commercial font, so until the licensed file is
// bought this is Oswald Light, the closest free tall, narrow, light sans. globals.css puts
// "Rules Gothic Condensed" first in --font-display, so a copy installed on the viewer's computer
// wins.
//
// next/font/local fails the build when its file is missing, so it's wired once the licensed file
// is at public/fonts/rules-gothic-condensed-light.woff2: replace this with
//   import localFont from "next/font/local";
//   export const displayFont = localFont({
//     src: "../../public/fonts/rules-gothic-condensed-light.woff2",
//     weight: "300",
//     variable: "--font-display-face",
//     display: "swap",
//   });
export const displayFont = Oswald({
  subsets: ["latin"],
  weight: "300",
  variable: "--font-display-face",
  display: "swap",
});
