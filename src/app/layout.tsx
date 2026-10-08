import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { OrdersLoader } from "@/components/shell/orders-loader";
import { OrdersAutoCheck } from "@/components/shell/orders-auto-check";
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
    <html lang="uz" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
        <OrdersLoader />
        <OrdersAutoCheck />
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
