import type { Metadata } from "next";
import {
  Bebas_Neue,
  Manrope,
  Oswald,
  UnifrakturCook,
} from "next/font/google";
import "./globals.css";
import { DebugConsole } from "@/components/DebugConsole";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const bebas = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  display: "swap",
});

// Old English / blackletter for marquee titles and scoreboard numbers —
// the Crown Bar identity leans into the "old pub" register.
const blackletter = UnifrakturCook({
  variable: "--font-blackletter",
  weight: "700",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crown Bar 4.90 — Pub futbolero · Cafetería · Jukebox social",
  description:
    "Crown Bar 4.90: la música la eliges tú desde tu mesa. Pub futbolero y cafetería con jukebox social — escanea el QR y pon tu canción en la cola.",
  metadataBase: new URL("https://crownbar490.local"),
  icons: {
    // Sobreescribe el favicon default que Next pone automáticamente
    // desde app/favicon.ico (que muestra el logo de Vercel/Next).
    // El PNG es alta resolución y los navegadores lo down-samplean.
    icon: [
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: [{ url: "/logo.png" }],
    apple: [{ url: "/logo.png" }],
  },
  openGraph: {
    title: "Crown Bar 4.90 — La música la eliges tú",
    description:
      "Pub futbolero y cafetería con jukebox social. Escanea el QR de tu mesa y elige la música que suena en el bar.",
    type: "website",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${manrope.variable} ${bebas.variable} ${oswald.variable} ${blackletter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <DebugConsole />
        {children}
      </body>
    </html>
  );
}
