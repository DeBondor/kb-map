"use client";

import { useEffect } from "react";

/** Registers the service worker (production only — dev HMR and a SW cache
 *  fight each other). Renders nothing. */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* unsupported / blocked — the app works fine without it */
    });
  }, []);
  return null;
}
