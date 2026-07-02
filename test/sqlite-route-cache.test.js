"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  FAILURE_TTL_MS,
  SUCCESS_TTL_MS,
  createSqliteRouteCache
} = require("../src/routes/sqlite-route-cache");

test("persists successful routes and expires them after 30 days", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adsb-routes-"));
  const filename = path.join(directory, "routes.sqlite");
  let clock = 1_000_000;
  const route = {
    callsign: "SWA1341",
    origin: { icao: "KPNS", iata: "PNS", name: "Pensacola" },
    destination: { icao: "KHOU", iata: "HOU", name: "Houston Hobby" },
    airline: "Southwest Airlines",
    scheduledDeparture: "2026-06-24T18:30:00Z",
    scheduledDepartureLabel: "TAKEOFF",
    scheduledArrival: "2026-06-24T19:42:00Z",
    scheduledArrivalLabel: "ETA",
    progress: 47
  };

  const cache = await createSqliteRouteCache({ filename, now: () => clock });
  await cache.put("SWA1341", route);
  assert.deepEqual(await cache.get("SWA1341"), { success: true, route });
  assert.equal(fs.existsSync(filename), true);

  const reopened = await createSqliteRouteCache({ filename, now: () => clock });
  assert.deepEqual(await reopened.get("SWA1341"), { success: true, route });

  clock += SUCCESS_TTL_MS;
  assert.equal(await reopened.get("SWA1341"), null);
});

test("negative cache entries expire after 12 hours", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adsb-routes-"));
  const filename = path.join(directory, "routes.sqlite");
  let clock = 2_000_000;
  const cache = await createSqliteRouteCache({ filename, now: () => clock });

  await cache.put("DAL225", null);
  assert.deepEqual(await cache.get("DAL225"), { success: false, route: null });

  clock += FAILURE_TTL_MS;
  assert.equal(await cache.get("DAL225"), null);
});

test("persists airport and airline metadata caches", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adsb-routes-"));
  const filename = path.join(directory, "routes.sqlite");
  const cache = await createSqliteRouteCache({ filename });
  const airport = { name: "Pensacola International Airport", iata: "PNS", icao: "KPNS" };

  await cache.putAirport("PNS", airport);
  await cache.putAirline("CNS", "PlaneSense");

  assert.deepEqual(await cache.getAirport("PNS"), { success: true, value: airport });
  assert.deepEqual(await cache.getAirline("CNS"), { success: true, value: "PlaneSense" });

  const reopened = await createSqliteRouteCache({ filename });
  assert.deepEqual(await reopened.getAirport("PNS"), { success: true, value: airport });
  assert.deepEqual(await reopened.getAirline("CNS"), { success: true, value: "PlaneSense" });
});
