"use strict";

const path = require("node:path");
const express = require("express");
const { selectAircraft } = require("./aircraft");
const { createPhotoService } = require("./photos");
const { createFr24Provider } = require("./routes/fr24-provider");
const { RouteProvider, isRouteEligible, routeCacheKey } = require("./routes/route-provider");
const { createSqliteRouteCache } = require("./routes/sqlite-route-cache");

const app = express();
const port = Number(process.env.PORT) || 3000;
const aircraftUrl =
  process.env.AIRCRAFT_URL || "http://localhost:8080/data/aircraft.json";
const pollIntervalMs = Math.max(Number(process.env.POLL_INTERVAL_MS) || 5000, 1000);
const fetchTimeoutMs = Math.max(Number(process.env.FETCH_TIMEOUT_MS) || 4000, 500);
const photoTimeoutMs = Math.max(Number(process.env.PHOTO_TIMEOUT_MS) || 4500, 500);
const routeTimeoutMs = Math.max(Number(process.env.ROUTE_TIMEOUT_MS) || 5000, 500);
const routeCachePath =
  process.env.ROUTE_CACHE_PATH || path.join(__dirname, "..", "data", "routes.sqlite");
const fr24ApiToken = process.env.FR24_API_TOKEN?.trim();
const fr24RouteMode = process.env.FR24_ROUTE_MODE?.trim() || "summary-first";
const photoService = createPhotoService({
  contact: process.env.PLANESPOTTERS_CONTACT?.trim(),
  timeoutMs: photoTimeoutMs
});
let routeService = null;

let state = {
  aircraft: null,
  totalAircraft: 0,
  status: "starting",
  error: null,
  sourceTimestamp: null,
  updatedAt: null,
  trend: null,
  photo: null,
  photoStatus: "idle",
  route: null,
  routeStatus: "idle"
};

const distanceHistory = new Map();

function determineTrend(aircraft) {
  if (!aircraft?.hex || aircraft.distance === null) {
    return null;
  }

  const previousDistance = distanceHistory.get(aircraft.hex);
  distanceHistory.set(aircraft.hex, aircraft.distance);

  if (previousDistance === undefined) {
    return null;
  }

  const change = aircraft.distance - previousDistance;
  if (Math.abs(change) < 0.1) {
    return "Holding";
  }

  return change < 0 ? "Approaching" : "Departing";
}

function beginPhotoLookup(aircraft) {
  if (!aircraft?.hex) {
    state.photo = null;
    state.photoStatus = "unavailable";
    return;
  }

  const cachedPhoto = photoService.getCached(aircraft.hex);
  if (cachedPhoto !== undefined) {
    state.photo = cachedPhoto;
    state.photoStatus = cachedPhoto ? "available" : "unavailable";
    return;
  }

  state.photo = null;
  state.photoStatus = "loading";

  photoService.lookup(aircraft).then((photo) => {
    if (state.aircraft?.hex !== aircraft.hex) {
      return;
    }

    state.photo = photo;
    state.photoStatus = photo ? "available" : "unavailable";
  });
}

function routeKey(aircraft) {
  return routeCacheKey(aircraft);
}

function beginRouteLookup(aircraft) {
  if (!isRouteEligible(aircraft)) {
    state.route = null;
    state.routeStatus = "ineligible";
    return;
  }

  if (!routeService) {
    state.route = null;
    state.routeStatus = "disabled";
    return;
  }

  const lookupKey = routeKey(aircraft);
  state.route = null;
  state.routeStatus = "loading";

  routeService.lookup(aircraft).then(({ route, status }) => {
    if (routeKey(state.aircraft) !== lookupKey) {
      return;
    }

    state.route = route;
    state.routeStatus = status;
  });
}

async function pollAircraft() {
  try {
    const response = await fetch(aircraftUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(fetchTimeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Ultrafeeder returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const selected = selectAircraft(data.aircraft);

    const previousHex = state.aircraft?.hex;
    const previousRouteKey = routeKey(state.aircraft);
    const selectedRouteKey = routeKey(selected);
    const trend = determineTrend(selected);

    state = {
      aircraft: selected,
      totalAircraft: Array.isArray(data.aircraft) ? data.aircraft.length : 0,
      status: selected ? "online" : "scanning",
      error: null,
      sourceTimestamp: Number.isFinite(Number(data.now)) ? Number(data.now) : null,
      updatedAt: new Date().toISOString(),
      trend,
      photo: previousHex === selected?.hex ? state.photo : null,
      photoStatus: previousHex === selected?.hex ? state.photoStatus : "idle",
      route: previousRouteKey === selectedRouteKey ? state.route : null,
      routeStatus: previousRouteKey === selectedRouteKey ? state.routeStatus : "idle"
    };

    beginPhotoLookup(selected);
    if (previousRouteKey !== selectedRouteKey) {
      beginRouteLookup(selected);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Aircraft fetch failed: ${error.message}`);
    state = {
      ...state,
      status: "error",
      error: "Aircraft feed temporarily unavailable",
      updatedAt: new Date().toISOString()
    };
  }
}

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/aircraft", (_request, response) => {
  response.set("Cache-Control", "no-store");
  response.json(state);
});

app.get("/api/route", (_request, response) => {
  response.set("Cache-Control", "no-store");
  response.json({
    aircraftKey: routeKey(state.aircraft),
    status: state.routeStatus,
    route: state.route
  });
});

app.get("/health", (_request, response) => {
  const healthy = state.status !== "error";
  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    feedStatus: state.status,
    updatedAt: state.updatedAt
  });
});

async function start() {
  if (fr24ApiToken) {
    const routeCache = await createSqliteRouteCache({ filename: routeCachePath });
    const fr24Provider = createFr24Provider({
      token: fr24ApiToken,
      cache: routeCache,
      mode: fr24RouteMode,
      timeoutMs: routeTimeoutMs
    });
    routeService = new RouteProvider({
      cache: routeCache,
      provider: fr24Provider
    });
    console.log(`Route cache: ${routeCachePath}`);
    console.log(`FR24 route mode: ${fr24Provider.mode}`);
  } else {
    console.warn("Route lookup disabled: FR24_API_TOKEN is not configured.");
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`AirAtlas listening on http://0.0.0.0:${port}`);
    console.log(`Aircraft source: ${aircraftUrl}`);

    pollAircraft();
    setInterval(pollAircraft, pollIntervalMs);
  });
}

start().catch((error) => {
  console.error(`Failed to start AirAtlas: ${error.stack || error.message}`);
  process.exitCode = 1;
});
