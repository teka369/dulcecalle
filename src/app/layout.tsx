import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { PreviewHostBridge } from "@/components/shell/PreviewHostBridge";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
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
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
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
    <html lang="es" data-theme="amber" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">
        <PreviewHostBridge />
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
