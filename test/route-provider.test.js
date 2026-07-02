"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RouteProvider,
  isRouteEligible,
  normalizeCallsign,
  routeCacheKey,
  trackBucket
} = require("../src/routes/route-provider");

test("normalizes and recognizes genuine airline-style callsigns", () => {
  assert.equal(normalizeCallsign(" swa1341 "), "SWA1341");
  assert.equal(
    isRouteEligible({ flight: " SWA1341 ", registration: "N8548P" }),
    true
  );
});

test("rejects registrations, missing fields, and non-airline callsigns", () => {
  assert.equal(isRouteEligible({ flight: "N123AB", registration: "N123AB" }), false);
  assert.equal(isRouteEligible({ flight: "SWA1341" }), false);
  assert.equal(isRouteEligible({ flight: "N123AB", registration: "N456CD" }), false);
  assert.equal(isRouteEligible({ flight: "DAL", registration: "N123AB" }), false);
});

test("builds a registration and track-aware route cache key", () => {
  assert.equal(
    routeCacheKey({ flight: " swa1341 ", registration: " n8548p ", track: 41 }),
    "SWA1341|N8548P|TRK:1"
  );
  assert.equal(
    routeCacheKey({ flight: "SWA1341", registration: "N8548P", track: 221 }),
    "SWA1341|N8548P|TRK:5"
  );
  assert.equal(trackBucket(null), null);
});

test("uses a valid cache entry without calling the provider", async () => {
  let providerCalls = 0;
  const route = { callsign: "DAL225" };
  const service = new RouteProvider({
    cache: {
      get: async () => ({ success: true, route }),
      put: async () => assert.fail("cache put should not run")
    },
    provider: {
      lookup: async () => {
        providerCalls += 1;
      }
    },
    logger: { log() {}, error() {} }
  });

  assert.deepEqual(
    await service.lookup({ flight: "DAL225", registration: "N123DL" }),
    { status: "available", route }
  );
  assert.equal(providerCalls, 0);
});

test("negative cache prevents an API request", async () => {
  let providerCalls = 0;
  const service = new RouteProvider({
    cache: {
      get: async () => ({ success: false, route: null }),
      put: async () => assert.fail("cache put should not run")
    },
    provider: {
      lookup: async () => {
        providerCalls += 1;
      }
    },
    logger: { log() {}, error() {} }
  });

  assert.deepEqual(
    await service.lookup({ flight: "AAL1047", registration: "N123AA" }),
    { status: "unavailable", route: null }
  );
  assert.equal(providerCalls, 0);
});

test("cache miss calls provider once and stores the result", async () => {
  const stored = [];
  const route = { callsign: "SWA1341" };
  const service = new RouteProvider({
    cache: {
      get: async () => null,
      put: async (...args) => stored.push(args)
    },
    provider: { lookup: async () => route },
    logger: { log() {}, error() {} }
  });

  assert.deepEqual(
    await service.lookup({ flight: "SWA1341", registration: "N8548P" }),
    { status: "available", route }
  );
  assert.deepEqual(stored, [
    [
      "SWA1341|N8548P|TRK:NA",
      route,
      { callsign: "SWA1341", registration: "N8548P" }
    ]
  ]);
});
