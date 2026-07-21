/**
 * CLI wrapper for the static GTFS builder (the logic lives in
 * lib/gtfs-builder.ts so the server's nightly auto-rebuild can import it).
 *
 * Usage:
 *   npm run build:gtfs -- --date 2026-07-05 --out output/gtfs --concurrency 40 --zip
 *   npm run build:gtfs -- --no-zip
 */
import { parseArgs } from "node:util";

import * as config from "../lib/config";
import { buildGtfs } from "../lib/gtfs-builder";

function main(): void {
  const { values } = parseArgs({
    options: {
      date: { type: "string", default: config.todayLocalISO() },
      out: { type: "string", default: config.GTFS_DIR },
      concurrency: { type: "string", default: String(config.DEFAULT_CONCURRENCY) },
      zip: { type: "boolean", default: true },
      "no-zip": { type: "boolean", default: false },
    },
  });
  const doZip = values["no-zip"] ? false : Boolean(values.zip);
  const concurrencyNum = Number(values.concurrency);
  const concurrency = Number.isFinite(concurrencyNum) && concurrencyNum > 0
    ? Math.trunc(concurrencyNum)
    : config.DEFAULT_CONCURRENCY;

  buildGtfs({ date: values.date as string, outDir: values.out as string, concurrency, zip: doZip }).catch(
    (err: unknown) => {
      console.error(`[gtfs] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    },
  );
}

main();
