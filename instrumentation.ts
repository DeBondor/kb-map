/**
 * Next.js instrumentation hook — starts the live poller once per Node.js
 * server process at boot.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("./lib/poller-singleton");
    const { log } = await import("./lib/logger");
    void startPoller().catch((err: unknown) => {
      log.error("rt", `background poller start failed: ${err}`);
    });
  }
}
