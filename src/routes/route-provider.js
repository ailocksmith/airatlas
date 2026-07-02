"use strict";

const AIRLINE_CALLSIGN = /^[A-Z]{3}\d{1,4}[A-Z]?$/;
const TRACK_BUCKET_DEGREES = 45;

function normalizeCallsign(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeRegistration(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function trackBucket(track) {
  if (track === null || track === undefined || track === "") {
    return null;
  }

  const number = Number(track);
  if (!Number.isFinite(number)) {
    return null;
  }

  const normalized = ((number % 360) + 360) % 360;
  return Math.round(normalized / TRACK_BUCKET_DEGREES) % (360 / TRACK_BUCKET_DEGREES);
}

function routeCacheKey(aircraft) {
  const callsign = normalizeCallsign(aircraft?.flight);
  const registration = normalizeRegistration(aircraft?.registration);
  const bucket = trackBucket(aircraft?.track);
  return [callsign, registration, bucket === null ? "TRK:NA" : `TRK:${bucket}`].join("|");
}

function isRouteEligible(aircraft) {
  const callsign = normalizeCallsign(aircraft?.flight);
  const registration = normalizeRegistration(aircraft?.registration);

  return Boolean(
    callsign &&
      registration &&
      callsign !== registration &&
      AIRLINE_CALLSIGN.test(callsign)
  );
}

class RouteProvider {
  constructor({ cache, provider, logger = console }) {
    this.cache = cache;
    this.provider = provider;
    this.logger = logger;
    this.pending = new Map();
  }

  async lookup(aircraft) {
    if (!isRouteEligible(aircraft)) {
      return { status: "ineligible", route: null };
    }

    const callsign = normalizeCallsign(aircraft.flight);
    const cacheKey = routeCacheKey(aircraft);
    const registration = normalizeRegistration(aircraft.registration);
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      this.logger.log(`[route] cache hit ${cacheKey} (${cached.success ? "success" : "negative"})`);
      return {
        status: cached.success ? "available" : "unavailable",
        route: cached.success ? cached.route : null
      };
    }

    this.logger.log(`[route] cache miss ${cacheKey}`);

    if (this.pending.has(cacheKey)) {
      return this.pending.get(cacheKey);
    }

    const request = (async () => {
      try {
        const route = await this.provider.lookup({
          callsign,
          registration
        });

        await this.cache.put(cacheKey, route, { callsign, registration });
        this.logger.log(`[route] cache insert ${cacheKey} (${route ? "success" : "negative"})`);
        return {
          status: route ? "available" : "unavailable",
          route
        };
      } catch (error) {
        this.logger.error(`[route] lookup failed ${cacheKey}: ${error.message}`);
        await this.cache.put(cacheKey, null, { callsign, registration });
        this.logger.log(`[route] cache insert ${cacheKey} (negative)`);
        return { status: "unavailable", route: null };
      } finally {
        this.pending.delete(cacheKey);
      }
    })();

    this.pending.set(cacheKey, request);
    return request;
  }
}

module.exports = {
  AIRLINE_CALLSIGN,
  RouteProvider,
  isRouteEligible,
  normalizeCallsign,
  normalizeRegistration,
  routeCacheKey,
  trackBucket
};
