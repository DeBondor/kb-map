import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Komunikacja Beskidzka — mapa pojazdów na żywo",
    short_name: "KB Mapa",
    description:
      "Wszystkie autobusy Komunikacji Beskidzkiej na jednej mapie: pozycje na żywo, opóźnienia, rozkłady przystanków i trasy linii.",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1013",
    theme_color: "#0d1013",
    lang: "pl",
    categories: ["travel", "navigation", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
