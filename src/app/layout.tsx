import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale } from "next-intl/server";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
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
      </body>
    </html>
  );
}
