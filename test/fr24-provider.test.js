"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseFlight,
  chooseLiveSummary,
  createFr24Provider,
  normalizeTimestamp,
  timingDetails
} = require("../src/routes/fr24-provider");

test("prefers the callsign result matching the selected registration", () => {
  const selected = chooseFlight(
    {
      data: [
        { callsign: "SWA1341", reg: "N000AA" },
        { callsign: "SWA1341", reg: "N8548P" }
      ]
    },
    "SWA1341",
    "N8548P"
  );
  assert.equal(selected.reg, "N8548P");
});

test("maps live position and static metadata into a provider-neutral route", async () => {
  const urls = [];
  const fetchImpl = async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.authorization, "Bearer secret-token");
    assert.equal(options.headers["accept-version"], "v1");

    if (url.includes("/live/flight-positions/full")) {
      return response({
        data: [
          {
            callsign: "SWA1341",
            reg: "N8548P",
            orig_iata: "PNS",
            orig_icao: "KPNS",
            dest_iata: "HOU",
            dest_icao: "KHOU",
            operating_as: "SWA",
            eta: "2026-06-24T19:42:00Z"
          }
        ]
      });
    }
    if (url.includes("/airports/PNS/")) {
      return response({ name: "Pensacola International Airport", iata: "PNS", icao: "KPNS" });
    }
    if (url.includes("/airports/HOU/")) {
      return response({ name: "William P Hobby Airport", iata: "HOU", icao: "KHOU" });
    }
    return response({ name: "Southwest Airlines", iata: "WN", icao: "SWA" });
  };

  const provider = createFr24Provider({
    token: "secret-token",
    mode: "full-only",
    fetchImpl,
    logger: { log() {}, error() {} }
  });
  const route = await provider.lookup({ callsign: "SWA1341", registration: "N8548P" });

  assert.equal(route.origin.name, "Pensacola International Airport");
  assert.equal(route.destination.iata, "HOU");
  assert.equal(route.airline, "Southwest Airlines");
  assert.equal(route.scheduledDeparture, null);
  assert.equal(route.scheduledArrival, "2026-06-24T19:42:00Z");
  assert.equal(route.scheduledArrivalLabel, "ETA");
  assert.equal(route.progress, null);
  assert.equal(urls.length, 4);
});

test("normalizes FR24 timestamps and maps authoritative timing fields", () => {
  assert.equal(normalizeTimestamp("2026-06-24T18:30:00"), "2026-06-24T18:30:00Z");
  assert.equal(normalizeTimestamp("2026-06-24T18:30:00Z"), "2026-06-24T18:30:00Z");
  assert.equal(normalizeTimestamp("not a date"), null);

  assert.deepEqual(
    timingDetails({
      datetime_takeoff: "2026-06-24T18:30:00",
      eta: "2026-06-24T19:42:00Z",
      progress_percent: 47
    }),
    {
      scheduledDeparture: "2026-06-24T18:30:00Z",
      scheduledDepartureLabel: "TAKEOFF",
      scheduledArrival: "2026-06-24T19:42:00Z",
      scheduledArrivalLabel: "ETA",
      progress: 47
    }
  );
});

test("uses summary light first and avoids live full when a current match exists", async () => {
  const urls = [];
  const metadataCache = memoryMetadataCache();
  const provider = createFr24Provider({
    token: "secret-token",
    cache: metadataCache,
    now: () => Date.parse("2026-06-24T18:00:00Z"),
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/flight-summary/light")) {
        return response({
          data: [
            {
              callsign: "CNS128",
              reg: "N283AF",
              operating_as: "CNS",
              orig_icao: "KGVL",
              dest_icao: "KPNS",
              first_seen: "2026-06-24T16:00:00Z",
              flight_ended: false
            }
          ]
        });
      }
      if (url.includes("/airports/KGVL/")) {
        return response({ name: "Gainesville Lee Gilmer Memorial Airport", iata: "GVL", icao: "KGVL" });
      }
      if (url.includes("/airports/KPNS/")) {
        return response({ name: "Pensacola International Airport", iata: "PNS", icao: "KPNS" });
      }
      return response({ name: "PlaneSense", icao: "CNS" });
    },
    logger: { log() {}, error() {} }
  });

  const route = await provider.lookup({ callsign: "CNS128", registration: "N283AF" });
  assert.equal(route.origin.iata, "GVL");
  assert.equal(route.airline, "PlaneSense");
  assert.equal(route.scheduledDeparture, "2026-06-24T16:00:00Z");
  assert.equal(route.scheduledDepartureLabel, "FIRST SEEN");
  assert.equal(urls.some((url) => url.includes("/live/flight-positions/full")), false);
  assert.equal(urls.length, 4);
});

test("falls back to live full when summary light has no current match", async () => {
  const urls = [];
  const provider = createFr24Provider({
    token: "secret-token",
    cache: memoryMetadataCache(),
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/flight-summary/light")) {
        return response({ data: [] });
      }
      if (url.includes("/live/flight-positions/full")) {
        return response({
          data: [
            {
              callsign: "DAL225",
              reg: "N225DL",
              orig_iata: "ATL",
              orig_icao: "KATL",
              dest_iata: "PNS",
              dest_icao: "KPNS",
              operating_as: "DAL"
            }
          ]
        });
      }
      if (url.includes("/airports/ATL/")) {
        return response({ name: "Hartsfield-Jackson Atlanta International Airport", iata: "ATL", icao: "KATL" });
      }
      if (url.includes("/airports/PNS/")) {
        return response({ name: "Pensacola International Airport", iata: "PNS", icao: "KPNS" });
      }
      return response({ name: "Delta Air Lines", icao: "DAL" });
    },
    logger: { log() {}, error() {} }
  });

  const route = await provider.lookup({ callsign: "DAL225", registration: "N225DL" });
  assert.equal(route.destination.iata, "PNS");
  assert.equal(urls.some((url) => url.includes("/flight-summary/light")), true);
  assert.equal(urls.some((url) => url.includes("/live/flight-positions/full")), true);
});

test("chooses only a current summary matching both callsign and registration", () => {
  const selected = chooseLiveSummary(
    {
      data: [
        { callsign: "CNS128", reg: "N283AF", orig_icao: "KGVL", dest_icao: "KPNS", flight_ended: true },
        { callsign: "CNS128", reg: "N999ZZ", orig_icao: "KGVL", dest_icao: "KPNS", flight_ended: false },
        { callsign: "CNS128", reg: "N283AF", orig_icao: "KGVL", dest_icao: "KPNS", flight_ended: false }
      ]
    },
    "CNS128",
    "N283AF"
  );
  assert.equal(selected.reg, "N283AF");
  assert.equal(selected.flight_ended, false);
});

test("reuses cached airport and airline metadata across route lookups", async () => {
  const urls = [];
  const provider = createFr24Provider({
    token: "secret-token",
    mode: "full-only",
    cache: memoryMetadataCache(),
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/live/flight-positions/full")) {
        return response({
          data: [
            {
              callsign: "CNS128",
              reg: "N283AF",
              orig_icao: "KGVL",
              dest_icao: "KPNS",
              operating_as: "CNS"
            }
          ]
        });
      }
      if (url.includes("/airports/KGVL/")) {
        return response({ name: "Gainesville", iata: "GVL", icao: "KGVL" });
      }
      if (url.includes("/airports/KPNS/")) {
        return response({ name: "Pensacola", iata: "PNS", icao: "KPNS" });
      }
      return response({ name: "PlaneSense", icao: "CNS" });
    },
    logger: { log() {}, error() {} }
  });

  await provider.lookup({ callsign: "CNS128", registration: "N283AF" });
  await provider.lookup({ callsign: "CNS128", registration: "N283AF" });

  assert.equal(urls.filter((url) => url.includes("/static/airports/")).length, 2);
  assert.equal(urls.filter((url) => url.includes("/static/airlines/")).length, 1);
  assert.equal(urls.filter((url) => url.includes("/live/flight-positions/full")).length, 2);
});

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function memoryMetadataCache() {
  const airports = new Map();
  const airlines = new Map();
  return {
    getAirport: async (key) => airports.get(key) || null,
    putAirport: async (key, value) =>
      airports.set(key, { success: Boolean(value), value }),
    getAirline: async (key) => airlines.get(key) || null,
    putAirline: async (key, value) =>
      airlines.set(key, { success: Boolean(value), value })
  };
}
