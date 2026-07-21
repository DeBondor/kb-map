import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { col, parseCsvLine, splitLines } from "../lib/gtfs-csv";

describe("parseCsvLine (RFC-4180)", () => {
  it("splits plain fields", () => {
    assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    assert.deepEqual(parseCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
  });

  it('unescapes doubled quotes ("")', () => {
    assert.deepEqual(parseCsvLine('a,"he said ""hi""",c'), ["a", 'he said "hi"', "c"]);
  });

  it("preserves empty cells including a trailing one", () => {
    assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
    assert.deepEqual(parseCsvLine("a,b,"), ["a", "b", ""]);
    assert.deepEqual(parseCsvLine(""), [""]);
  });
});

describe("splitLines", () => {
  it("splits CRLF, CR and LF alike so no '\\r' sticks to a column", () => {
    assert.deepEqual(splitLines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
    assert.deepEqual(splitLines("a\r\n"), ["a", ""]);
  });
});

describe("col", () => {
  it("finds a header index or returns -1", () => {
    const header = ["stop_id", "stop_name"];
    assert.equal(col(header, "stop_name"), 1);
    assert.equal(col(header, "missing"), -1);
  });
});
