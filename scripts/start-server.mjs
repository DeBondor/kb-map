import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = process.argv[2] || process.env.PORT || "8080";
const standaloneServer = path.join(process.cwd(), ".next", "standalone", "server.js");

/**
 * `output: "standalone"` bundles server.js but NOT the static assets — Next
 * leaves it to the deploy step (see Dockerfile) to copy `.next/static` and
 * `public` alongside it. For a local `npm start` there is no such step, so the
 * standalone server 404s every `/_next/static/*` chunk and the app renders a
 * blank shell. Mirror those two dirs in before launching.
 */
function syncStandaloneAssets() {
  const root = process.cwd();
  const pairs = [
    [path.join(root, ".next", "static"), path.join(root, ".next", "standalone", ".next", "static")],
    [path.join(root, "public"), path.join(root, ".next", "standalone", "public")],
  ];
  for (const [src, dest] of pairs) {
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }
}

let child;
if (fs.existsSync(standaloneServer)) {
  syncStandaloneAssets();
  child = spawn(process.execPath, [standaloneServer], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
      // server.js chdirs into .next/standalone; keep output/ (GTFS feeds, logs)
      // resolving to the repo root so build:gtfs output stays visible.
      KB_OUTPUT_DIR: process.env.KB_OUTPUT_DIR || path.join(process.cwd(), "output"),
    },
  });
} else {
  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "next.cmd" : "next",
  );
  child = spawn(nextBin, ["start", "-p", port], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
