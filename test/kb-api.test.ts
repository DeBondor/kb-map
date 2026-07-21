/**
 * Parity pins for the pure helpers in lib/kb-api.ts. These assert the ported
 * Python semantics (truthiness, int()/float(), positional stop rows) — a
 * failing test here means a parity regression, not a bug in the test.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { b64ExecId, execIdPathSegment, parseIntStrict, parseStops, parseTrip, pyFloat, pyTruthy } from "../lib/kb-api";

describe("pyTruthy (Python truthiness)", () => {
  it("treats empty containers and zero as falsy", () => {
    assert.equal(pyTruthy(null), false);
    assert.equal(pyTruthy(undefined), false);
    assert.equal(pyTruthy(false), false);
    assert.equal(pyTruthy(0), false);
    assert.equal(pyTruthy(NaN), false);
    assert.equal(pyTruthy(""), false);
    assert.equal(pyTruthy([]), false);
    assert.equal(pyTruthy({}), false);
  });

  it('treats "0" as truthy — unlike JS, like Python', () => {
    assert.equal(pyTruthy("0"), true);
    assert.equal(pyTruthy(" "), true);
  });

  it("treats non-empty values as truthy", () => {
    assert.equal(pyTruthy(true), true);
    assert.equal(pyTruthy(1), true);
    assert.equal(pyTruthy(-1), true);
    assert.equal(pyTruthy([0]), true);
    assert.equal(pyTruthy({ a: 0 }), true);
  });
});

describe("parseIntStrict (Python int())", () => {
  it("truncates finite numbers toward zero", () => {
    assert.equal(parseIntStrict(3.9), 3);
    assert.equal(parseIntStrict(-3.9), -3);
    assert.equal(parseIntStrict(0), 0);
  });

  it("rejects non-finite numbers", () => {
    assert.equal(parseIntStrict(Infinity), null);
    assert.equal(parseIntStrict(NaN), null);
  });

  it("accepts only pure-integer strings (trimmed, optional sign)", () => {
    assert.equal(parseIntStrict(" 42 "), 42);
    assert.equal(parseIntStrict("+7"), 7);
    assert.equal(parseIntStrict("-7"), -7);
    assert.equal(parseIntStrict("12.5"), null);
    assert.equal(parseIntStrict("0x10"), null);
    assert.equal(parseIntStrict("1e3"), null);
    assert.equal(parseIntStrict(""), null);
  });

  it("rejects non-number non-string values", () => {
    assert.equal(parseIntStrict(null), null);
    assert.equal(parseIntStrict(undefined), null);
    assert.equal(parseIntStrict([1]), null);
  });
});

describe("pyFloat (Python float())", () => {
  it("passes finite numbers through", () => {
    assert.equal(pyFloat(2.5), 2.5);
    assert.equal(pyFloat(0), 0);
    assert.equal(pyFloat(NaN), null);
    assert.equal(pyFloat(Infinity), null);
  });

  it("parses numeric strings including scientific notation", () => {
    assert.equal(pyFloat("1e3"), 1000);
    assert.equal(pyFloat(" 2.5 "), 2.5);
    assert.equal(pyFloat(""), null);
    assert.equal(pyFloat("abc"), null);
  });

  it("rejects everything else", () => {
    assert.equal(pyFloat(null), null);
    assert.equal(pyFloat(true), null);
  });
});

describe("b64ExecId", () => {
  it("pins standard base64 with '=' padding for the real id shape", () => {
    assert.equal(b64ExecId("19132:39688"), "MTkxMzI6Mzk2ODg=");
  });

  it("digits and ':' can never produce '/' or '+' (why plain base64 has worked)", () => {
    for (const id of ["1", "12345", "19132:39688", "999999:1:2"]) {
      assert.doesNotMatch(b64ExecId(id), /[/+]/);
    }
  });
});

describe("execIdPathSegment", () => {
  it("is a byte-identical no-op for the real digit/colon id shape", () => {
    for (const id of ["1", "12345", "19132:39688", "999999:1:2"]) {
      assert.equal(execIdPathSegment(id), b64ExecId(id));
    }
  });

  it("escapes '/' and '+' so an exotic id cannot rewrite the upstream path", () => {
    // "zzz~" -> "enp6fg==" is clean; "???" -> "Pz8/" carries a slash
    assert.equal(b64ExecId("???"), "Pz8/");
    assert.equal(execIdPathSegment("???"), "Pz8%2F");
    assert.equal(b64ExecId("~~~"), "fn5+");
    assert.equal(execIdPathSegment("~~~"), "fn5%2B");
    assert.doesNotMatch(execIdPathSegment("\xFF\xFE\xFD"), /[/+]/);
  });
});

describe("parseStops (positional rows)", () => {
  const row = (
    urlId: string,
    internalId: unknown,
    name: string,
    lonMicro: unknown,
    latMicro: unknown,
    ...flags: unknown[]
  ) => [urlId, internalId, name, lonMicro, latMicro, ...flags];

  it("divides micro-degree coordinates by 1e6", () => {
    const stops = parseStops({ stops: [row("A:1", 10, "TESTOWA", 19_044_400, 49_822_500)] });
    assert.equal(stops.length, 1);
    assert.equal(stops[0].lon, 19.0444);
    assert.equal(stops[0].lat, 49.8225);
    assert.equal(stops[0].urlId, "A:1");
    assert.equal(stops[0].internalId, 10);
    assert.equal(stops[0].stopId, "10");
  });

  it("dedupes by internal id, keeping the first row", () => {
    const stops = parseStops({
      stops: [row("A", 10, "FIRST", 1, 2), row("B", 10, "SECOND", 3, 4)],
    });
    assert.equal(stops.length, 1);
    assert.equal(stops[0].name, "FIRST");
  });

  it("skips short rows and rows with unparsable id/coords", () => {
    const stops = parseStops({
      stops: [
        ["A", 10, "SHORT", 1], // length < 5
        row("B", "not-int", "BAD-ID", 1, 2),
        row("C", 11, "BAD-LON", "abc", 2),
        row("D", 12, "OK", 1, 2),
        "not-an-array",
      ],
    });
    assert.deepEqual(
      stops.map((s) => s.name),
      ["OK"],
    );
  });

  it("reads optional flag columns with Python truthiness, defaulting false", () => {
    const [bare] = parseStops({ stops: [row("A", 1, "N", 1, 2)] });
    assert.equal(bare.onlyDisembarking, false);
    assert.equal(bare.isStation, false);
    assert.equal(bare.showPlatforms, false);
    const [flagged] = parseStops({ stops: [row("B", 2, "N", 1, 2, 1, 0, true)] });
    assert.equal(flagged.onlyDisembarking, true);
    assert.equal(flagged.isStation, false);
    assert.equal(flagged.showPlatforms, true);
  });

  it("returns [] for non-record input or missing stops array", () => {
    assert.deepEqual(parseStops(null), []);
    assert.deepEqual(parseStops("x"), []);
    assert.deepEqual(parseStops({ stops: "nope" }), []);
  });
});

describe("parseTrip", () => {
  it("parses times with null coercions and defaults", () => {
    const trip = parseTrip(
      {
        times: [
          {
            stop_name: "PRZYSTANEK",
            designator: 5.7,
            place_id: "P:1",
            departure_time: "05:30",
            index: "2",
            platform: 3,
          },
          {},
        ],
        direction: "SZCZYRK",
        line: { name: "120", type: "bus" },
        vehicle_type: 1.9,
        current_station_id: 44,
      },
      "T1",
    );
    assert.equal(trip.tripId, "T1");
    assert.equal(trip.times.length, 2);
    assert.deepEqual(trip.times[0], {
      stopName: "PRZYSTANEK",
      designator: 5,
      placeId: "P:1",
      departureTime: "05:30",
      index: 2,
      platform: "3",
    });
    assert.deepEqual(trip.times[1], {
      stopName: "",
      designator: null,
      placeId: null,
      departureTime: "",
      index: 0,
      platform: null,
    });
    assert.equal(trip.direction, "SZCZYRK");
    assert.equal(trip.lineName, "120");
    assert.equal(trip.lineType, "bus");
    assert.equal(trip.vehicleType, 1);
    assert.equal(trip.currentStationId, 44);
  });

  it("show_name absent -> true; present falsy -> pyTruthy", () => {
    assert.equal(parseTrip({ line: {} }, "T").showName, true);
    assert.equal(parseTrip({ line: { show_name: 0 } }, "T").showName, false);
    assert.equal(parseTrip({ line: { show_name: 1 } }, "T").showName, true);
  });

  it("tolerates completely empty input", () => {
    const trip = parseTrip(null, "T");
    assert.deepEqual(trip.times, []);
    assert.equal(trip.direction, "");
    assert.equal(trip.lineName, "");
    assert.equal(trip.showName, true);
  });
});
