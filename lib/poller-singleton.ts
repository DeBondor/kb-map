/**
 * Process-wide singleton KbApi + LivePoller, cached on globalThis so it
 * survives Next.js dev-mode HMR module reloads.
 */
import { KbApi } from "./kb-api";
import { log } from "./logger";
import { LivePoller } from "./poller";

interface SingletonState {
  api: KbApi;
  poller: LivePoller;
  startPromise: Promise<void> | null;
  signalsRegistered: boolean;
}

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
    st.startPromise = st.poller
      .start()
      .then(() => {
        log.info("rt", `server up, ${st.poller.stops.length} stops loaded`);
      })
      .catch((err: unknown) => {
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
