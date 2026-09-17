import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DulceCalle",
  description: "PWA de ventas para dulcería de barrio",
  applicationName: "DulceCalle",
  appleWebApp: {
    capable: true,
    title: "DulceCalle",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFF9F2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
