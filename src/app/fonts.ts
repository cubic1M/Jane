import { Playfair_Display } from "next/font/google";

// The fallback for the landing page's biggest words. The face itself is Juliette (founder,
// 2026-10-26), loaded by @font-face in landing.css from a file kept out of git (its licence
// forbids sharing it); where that file is missing, this high-contrast display serif shows.
export const displayFont = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
});
