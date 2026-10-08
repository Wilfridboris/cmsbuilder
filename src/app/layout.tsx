import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale } from "next-intl/server";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { Providers } from "./providers";
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
  title: "Scheza",
  description:
    "Describe your business and get a working, Ontario-ready dashboard in seconds.",
  // Brand icon set (Story 15.3). The file-based `app/favicon.ico` already emits
  // `<link rel="icon" href="/favicon.ico" sizes="any">` for the classic tab icon;
  // this config export adds the modern SVG favicon + explicit PNG sizes (served
  // from `public/`) and the apple-touch-icon. Together with the manifest icons
  // (192/512/maskable) this gives every surface a branded Scheza icon.
  //
  // iOS: the manifest is Chromium-first, so the home-screen install for Safari
  // relies on these Apple-specific tags (Story 8.2). `appleWebApp.capable`
  // launches standalone (no browser chrome) from the saved icon; the brand
  // apple-touch-icon gives it a proper icon.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Scheza",
  },
};

// The standalone chrome's theme color (Story 8.2): matches the manifest
// `theme_color` so the status bar / title bar is branded in the installed app.
export const viewport: Viewport = {
  themeColor: "#342350",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const resolved = await getLocale();
  const locale = isLocale(resolved) ? resolved : defaultLocale;

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={locale}>
          <Providers>{children}</Providers>
        </LocaleProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
