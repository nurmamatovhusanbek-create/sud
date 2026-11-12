import type { Metadata } from "next";
import { Toaster } from "sonner";
import { OrdersLoader } from "@/components/shell/orders-loader";
import { OrdersAutoCheck } from "@/components/shell/orders-auto-check";
// v18 faces (Plus Jakarta Sans for the UI, IBM Plex Mono for figures) are self-hosted: fonts.css + ./fonts/*.woff2.
// Not next/font/google: that downloads from Google at dev/build time and fails offline or behind a firewall.
import "./fonts.css";
import "./globals.css";
import "./prototype.css";
// The new «Ixcham» look: every rule is scoped under html[data-ui='new'], so the classic look is untouched without it.
import "./ui-new.css";
import "./ui-green.css";
import { DEFAULT_UI, UI_BOOT_SCRIPT } from "@/core/ui-version";

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
    <html lang="uz" data-ui={DEFAULT_UI} data-theme="light" suppressHydrationWarning>
      <head>
        {/* the look (Settings › Koʻrinish) and the theme are decided before the first paint: no flash of the other one */}
        <script dangerouslySetInnerHTML={{ __html: UI_BOOT_SCRIPT }} />
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
