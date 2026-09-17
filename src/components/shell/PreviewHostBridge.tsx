"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const CHANNEL = "grok-preview-bridge";

/**
 * Lets the Grok live-preview chrome drive in-app navigation.
 * Noops when the app is not embedded in that chrome.
 */
export function PreviewHostBridge() {
  const router = useRouter();

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as {
        channel?: string;
        type?: string;
        path?: string;
        delta?: number;
      } | null;
      if (!data || data.channel !== CHANNEL) return;
      if (data.type === "navigate" && typeof data.path === "string") {
        if (!data.path.startsWith("/") || data.path.startsWith("//")) return;
        router.push(data.path);
      }
      if (data.type === "history" && (data.delta === -1 || data.delta === 1)) {
        if (data.delta === -1) router.back();
        else router.forward();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
