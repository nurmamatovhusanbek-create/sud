import type { Metadata } from "next";
import { Toaster } from "sonner";
import { OrdersLoader } from "@/components/shell/orders-loader";
import { OrdersAutoCheck } from "@/components/shell/orders-auto-check";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
// v18 faces (Plus Jakarta Sans for the UI, IBM Plex Mono for figures) are self-hosted: fonts.css + ./fonts/*.woff2.
// Not next/font/google: that downloads from Google at dev/build time and fails offline or behind a firewall.
import "./fonts.css";
import "./globals.css";
import "./prototype.css";

export const metadata: Metadata = {
  title: "Sud tizimi",
  description:
    "Sud tizimi · by Nurmamatov — sud ishlari, toʻlovlar, majlislar va kompaniya statistikasi.",
  // The ?v= suffix busts the browser's favicon cache (it keeps the old tab icon for days otherwise):
  // bump it whenever core/brand-mark.ts changes. The PNGs are the tile version, for browsers without
  // SVG favicons and for iOS (public/favicon-32.png, public/apple-touch-icon.png).
  icons: {
    icon: [
      { url: "/logo.svg?v=hukm", type: "image/svg+xml" },
      { url: "/favicon-32.png?v=hukm", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png?v=hukm",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz" data-theme="light" suppressHydrationWarning>
      <head>
        {/* the saved theme is put on <html> before the first paint: no flash of the other one */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <OrdersLoader />
        <OrdersAutoCheck />
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
