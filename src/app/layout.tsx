import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { ActivityRecorder } from "@/components/activity-recorder";
import { ImportChip } from "@/components/import-chip";
import { ServiceWorker } from "@/components/service-worker";
import { SiteFooter } from "@/components/site-footer";
import { SideChat } from "@/components/side-chat/side-chat";
import { TradePopup } from "@/components/trade-popup";
import { NavPending } from "@/components/nav-pending";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jane",
  description: "See how much money you're losing, and approve the fixes.",
  appleWebApp: { capable: true, title: "Jane", statusBarStyle: "default" },
  icons: { apple: "/icons/192" },
};

// viewportFit "cover" lets the phone tab bar (spec step 79) sit above the iPhone home indicator.
// interactiveWidget "resizes-content" makes the page (and so the message box) shrink above the
// phone keyboard instead of sliding under it (spec step 194).
export const viewport: Viewport = {
  themeColor: "#171717",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request, so its scripts carry that request's CSP nonce
  // (src/proxy.ts); a page prerendered at build time would have none and be blocked.
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
        {/* Docked beside every signed-in page, and kept when the page changes. It reads the
            address, so it waits in its own boundary (cache components). */}
        <Suspense>
          <SideChat />
        </Suspense>
        {/* The paper account's trade alerts: their own pop-up, apart from the suggestion dock. */}
        <Suspense>
          <TradePopup />
        </Suspense>
        {/* An upload finishing in the background, on every page (src/lib/import/background.ts). */}
        <ImportChip />
        {/* Every link tap shows at once that the next page is on its way. */}
        <Suspense>
          <NavPending />
        </Suspense>
        <ServiceWorker />
        {/* The beta's activity log: pages and buttons, not what anyone types (/privacy). */}
        <Suspense>
          <ActivityRecorder />
        </Suspense>
      </body>
    </html>
  );
}
