import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Komunikacja Beskidzka — mapa pojazdów na żywo",
  description:
    "Wszystkie autobusy Komunikacji Beskidzkiej na jednej mapie: pozycje na żywo, opóźnienia, rozkłady przystanków i trasy linii. Feed GTFS-RT (VehiclePositions) do pobrania.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "KB Mapa",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
  themeColor: "#0d1013",
  // edge-to-edge in standalone/notched displays; safe-area insets handled per component
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="h-dvh overflow-hidden bg-bg font-sans text-text antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
