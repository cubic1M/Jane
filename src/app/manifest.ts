import type { MetadataRoute } from "next";

// The web app manifest, so phones can add Jane to the home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Financial Controller",
    short_name: "Jane",
    description: "See how much money you're losing, and approve the fixes.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#047857",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
