import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/service-worker";
import { SiteFooter } from "@/components/site-footer";
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
  title: "Financial Controller",
  description: "See how much money you're losing, and approve the fixes.",
  appleWebApp: { capable: true, title: "Jane", statusBarStyle: "default" },
  icons: { apple: "/icons/192" },
};

// viewportFit "cover" lets the phone tab bar (spec step 79) sit above the iPhone home indicator.
export const viewport: Viewport = { themeColor: "#047857", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
        <ServiceWorker />
      </body>
    </html>
  );
}
