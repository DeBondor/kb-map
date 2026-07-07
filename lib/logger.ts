/**
 * Tiny leveled logger with ISO timestamps and a tag. No external deps.
 *
 * Usage: log.info("rt", "full scan ...")
 * Minimum level can be set via KB_LOG_LEVEL=info|warn|error (default info).
 */
type Level = "info" | "warn" | "error";

const ORDER: Record<Level, number> = { info: 0, warn: 1, error: 2 };

function minLevel(): Level {
  const v = (process.env.KB_LOG_LEVEL ?? "info").toLowerCase();
  return v === "warn" || v === "error" ? v : "info";
}

function fmt(part: unknown): string {
  if (typeof part === "string") return part;
  if (part instanceof Error) return part.stack ?? part.message;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

function emit(level: Level, tag: string, parts: unknown[]): void {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}] ${parts.map(fmt).join(" ")}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (tag: string, ...parts: unknown[]): void => emit("info", tag, parts),
  warn: (tag: string, ...parts: unknown[]): void => emit("warn", tag, parts),
  error: (tag: string, ...parts: unknown[]): void => emit("error", tag, parts),
};
