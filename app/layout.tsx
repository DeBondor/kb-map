import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Komunikacja Beskidzka — mapa pojazdów na żywo",
  applicationName: "KB Mapa",
  description:
    "Wszystkie autobusy Komunikacji Beskidzkiej na jednej mapie: pozycje na żywo, opóźnienia, rozkłady przystanków i trasy linii.",
  formatDetection: {
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "KB Mapa",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d1013" },
    { media: "(prefers-color-scheme: light)", color: "#0d1013" },
  ],
  // edge-to-edge in standalone/notched displays; safe-area insets handled per component
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className="h-dvh overscroll-none select-none">
      <body className="h-dvh overflow-hidden bg-bg font-sans text-text antialiased overscroll-none">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
