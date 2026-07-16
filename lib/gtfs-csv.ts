/**
 * Tiny CSV helpers shared by the GTFS-file readers (stop-directions, lines).
 * The built feed is plain RFC-4180 with CRLF line endings.
 */

/** Minimal RFC-4180 line parser (handles quoted fields with embedded commas). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Column index by header name, or -1. */
export function col(header: string[], name: string): number {
  return header.indexOf(name);
}

/** Split on CR, LF or CRLF so a trailing '\r' never sticks to the last column
 *  (the built GTFS files are CRLF). */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}
