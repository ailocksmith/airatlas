"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAircraft, selectAircraft } = require("../src/aircraft");

test("normalizes the Ultrafeeder field names", () => {
  assert.deepEqual(
    normalizeAircraft({
      hex: "ace60c",
      flight: " DAL1785 ",
      t: "B739",
      r: "N930DZ",
      desc: "BOEING 737-900ER",
      ownOp: "DELTA AIR LINES INC",
      year: "2019",
      alt_baro: 1825,
      gs: 251,
      r_dst: 4.7,
      r_dir: 220.3,
      rssi: -23.5
    }),
    {
      hex: "ACE60C",
      flight: "DAL1785",
      type: "B739",
      registration: "N930DZ",
      description: "BOEING 737-900ER",
      operator: "DELTA AIR LINES INC",
      year: "2019",
      altitude: 1825,
      groundSpeed: 251,
      track: null,
      distance: 4.7,
      bearing: 220.3,
      signal: -23.5
    }
  );
});

test("supports the older reg field as a fallback", () => {
  assert.equal(normalizeAircraft({ reg: "N12345" }).registration, "N12345");
});

test("selects the nearest aircraft", () => {
  const selected = selectAircraft([
    { hex: "far", r_dst: 12, rssi: -10 },
    { hex: "near", r_dst: 3, rssi: -30 }
  ]);

  assert.equal(selected.hex, "NEAR");
});

test("uses stronger RSSI when distances are similar", () => {
  const selected = selectAircraft([
    { hex: "slightly-nearer", r_dst: 3.1, rssi: -30 },
    { hex: "stronger", r_dst: 3.4, rssi: -10 }
  ]);

  assert.equal(selected.hex, "STRONGER");
});

test("does not let signal outweigh a meaningfully closer aircraft", () => {
  const selected = selectAircraft([
    { hex: "nearest", r_dst: 3, rssi: -30 },
    { hex: "strong-but-farther", r_dst: 3.6, rssi: -2 }
  ]);

  assert.equal(selected.hex, "NEAREST");
});

test("prefers any valid distance over aircraft without distance", () => {
  const selected = selectAircraft([
    { hex: "strong-no-distance", rssi: -2 },
    { hex: "has-distance", r_dst: 30, rssi: -40 }
  ]);

  assert.equal(selected.hex, "HAS-DISTANCE");
});

test("falls back to strongest RSSI if no aircraft has distance", () => {
  const selected = selectAircraft([
    { hex: "weak", rssi: -25 },
    { hex: "strong", rssi: -8 }
  ]);

  assert.equal(selected.hex, "STRONG");
});

test("returns null for an empty feed", () => {
  assert.equal(selectAircraft([]), null);
});
