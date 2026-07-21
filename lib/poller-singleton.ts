/**
 * Process-wide singleton KbApi + LivePoller, cached on globalThis so it
 * survives Next.js dev-mode HMR module reloads.
 */
import { startGtfsRefresh } from "./gtfs-refresh";
import { KbApi } from "./kb-api";
import { log } from "./logger";
import { LivePoller } from "./poller";

interface SingletonState {
  api: KbApi;
  poller: LivePoller;
  startPromise: Promise<void> | null;
  signalsRegistered: boolean;
  /** Epoch ms of the last failed start — gates the retry cooldown. */
  lastStartFailAt: number;
}

/** After a failed start, don't re-attempt loadStops() for this long. Without it
 *  every incoming request (5 s SWR poll, 30 s healthcheck) would immediately
 *  kick off another multi-fetch start attempt against a down upstream — and
 *  block for the attempt's full duration (up to ~77 s of timeouts) before its
 *  502. With the cooldown those requests fail fast and the upstream gets one
 *  attempt per window instead of a sustained hammer. */
const START_RETRY_COOLDOWN_MS = 30_000;

const KEY = Symbol.for("kb-gtfs.poller-singleton");

type GlobalWithState = typeof globalThis & { [KEY]?: SingletonState };

function state(): SingletonState {
  const g = globalThis as GlobalWithState;
  if (!g[KEY]) {
    const api = new KbApi();
    g[KEY] = {
      api,
      poller: new LivePoller(api),
      startPromise: null,
      signalsRegistered: false,
      lastStartFailAt: 0,
    };
  }
  return g[KEY];
}

/** The shared upstream API client. */
export function getApi(): KbApi {
  return state().api;
}

/** The shared poller; lazily kicks off startPoller() when not yet started. */
export function getPoller(): LivePoller {
  const st = state();
  if (!st.startPromise) {
    void startPoller().catch((err: unknown) => {
      log.error("rt", `background poller start failed: ${err}`);
    });
  }
  return st.poller;
}

/**
 * Idempotently start the singleton poller (loads stops, starts the loop).
 * A failed start resets so the next call retries.
 */
export function startPoller(): Promise<void> {
  const st = state();
  if (!st.startPromise) {
    if (Date.now() - st.lastStartFailAt < START_RETRY_COOLDOWN_MS) {
      return Promise.reject(new Error("poller start failed recently, retry pending"));
    }
    st.startPromise = st.poller
      .start()
      .then(() => {
        log.info("rt", `server up, ${st.poller.stops.length} stops loaded`);
        // single call site covers both the instrumentation path and every
        // route's lazy-start fallback; idempotent + HMR-safe internally
        startGtfsRefresh();
      })
      .catch((err: unknown) => {
        st.lastStartFailAt = Date.now();
        st.startPromise = null;
        throw err;
      });
    registerSignalHandlers(st);
  }
  return st.startPromise;
}

/** Register SIGTERM/SIGINT handlers once for graceful shutdown. */
function registerSignalHandlers(st: SingletonState): void {
  if (st.signalsRegistered) return;
  st.signalsRegistered = true;
  const shutdown = (sig: string): void => {
    log.info("rt", `${sig} received, stopping poller`);
    void st.poller.stop().catch((err: unknown) => {
      log.error("rt", `poller stop failed: ${err}`);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
