import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { PreviewHostBridge } from "@/components/shell/PreviewHostBridge";
import { SalesSyncBridge } from "@/components/shell/SalesSyncBridge";
import { PrepModal } from "@/components/shell/PrepModal";
import { PrepIndicator } from "@/components/shell/PrepIndicator";
import { SyncCenter } from "@/components/shell/SyncCenter";
import { SyncPill } from "@/components/shell/SyncPill";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { bootScriptSource } from "@/data/pwa/boot-restore";
import { bootEntityPatternSources } from "@/data/pwa/entity-href";
import "./globals.css";

const BOOT_SCRIPT = bootScriptSource(bootEntityPatternSources());

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
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
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F7F3EE",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-theme="amber"
      data-mode="light"
      className={`${jakarta.variable} h-full antialiased`}
      // The inline boot script may mark a cold offline ficha load before hydration.
      suppressHydrationWarning
    >
      <link
        href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap"
        rel="stylesheet"
      />
      <body className="min-h-full bg-bg font-sans text-ink">
        {/* Pre-hydration: remember the requested path (a cold offline ficha load is served its list document). */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <PreviewHostBridge />
        <SalesSyncBridge />
        <PrepModal />
        <PrepIndicator />
        <SyncPill />
        <SyncCenter />
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
