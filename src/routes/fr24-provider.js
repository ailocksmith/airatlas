"use strict";

const API_BASE = "https://fr24api.flightradar24.com/api";
const VALID_MODES = new Set(["summary-first", "full-only"]);

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTimestamp(value) {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text);
  const normalized = hasTimezone ? text : `${text}Z`;
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function explicitProgress(flight) {
  const progress = firstFiniteNumber(
    flight?.progress,
    flight?.progress_percent,
    flight?.percent_complete
  );

  if (progress === null || progress < 0 || progress > 100) {
    return null;
  }

  return progress;
}

function timingDetails(flight) {
  const takeoff = normalizeTimestamp(flight?.datetime_takeoff);
  const firstSeen = normalizeTimestamp(flight?.first_seen);
  const landed = normalizeTimestamp(flight?.datetime_landed);
  const eta = normalizeTimestamp(flight?.eta);

  return {
    scheduledDeparture: takeoff || firstSeen,
    scheduledDepartureLabel: takeoff ? "TAKEOFF" : firstSeen ? "FIRST SEEN" : null,
    scheduledArrival: landed || eta,
    scheduledArrivalLabel: landed ? "LANDED" : eta ? "ETA" : null,
    progress: explicitProgress(flight)
  };
}

function normalizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : "summary-first";
}

function chooseFlight(data, callsign, registration) {
  const flights = Array.isArray(data?.data) ? data.data : [];
  const normalizedCallsign = callsign.toUpperCase();
  const normalizedRegistration = registration?.trim().toUpperCase();

  return (
    flights.find(
      (flight) =>
        cleanText(flight.callsign)?.toUpperCase() === normalizedCallsign &&
        cleanText(flight.reg)?.toUpperCase() === normalizedRegistration
    ) ||
    flights.find(
      (flight) => cleanText(flight.callsign)?.toUpperCase() === normalizedCallsign
    ) ||
    null
  );
}

function chooseLiveSummary(data, callsign, registration) {
  const flights = Array.isArray(data?.data) ? data.data : [];
  const normalizedCallsign = callsign.toUpperCase();
  const normalizedRegistration = registration?.trim().toUpperCase();

  const candidates = flights
    .filter(
      (flight) =>
        cleanText(flight.callsign)?.toUpperCase() === normalizedCallsign &&
        cleanText(flight.reg)?.toUpperCase() === normalizedRegistration &&
        flight.flight_ended !== true &&
        cleanText(flight.orig_icao) &&
        cleanText(flight.dest_icao)
    )
    .sort((a, b) => Date.parse(b.first_seen || 0) - Date.parse(a.first_seen || 0));

  return candidates[0] || null;
}

function utcParameter(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}

function createFr24Provider({
  token,
  cache,
  mode = "summary-first",
  timeoutMs = 5000,
  fetchImpl = fetch,
  logger = console,
  now = () => Date.now()
}) {
  const routeMode = normalizeMode(mode);

  async function request(path) {
    logger.log(`[route] FR24 request ${path}`);

    const response = await fetchImpl(`${API_BASE}${path}`, {
      headers: {
        accept: "application/json",
        "accept-version": "v1",
        authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    logger.log(`[route] FR24 response status ${response.status}`);

    if (!response.ok) {
      throw new Error(`FR24 returned HTTP ${response.status}`);
    }

    return response.json();
  }

  async function airportDetails(code) {
    if (!code) {
      return null;
    }

    const key = code.toUpperCase();
    const cached = await cache?.getAirport(key);
    if (cached) {
      logger.log(`[route] airport cache hit ${key} (${cached.success ? "success" : "negative"})`);
      return cached.value;
    }

    logger.log(`[route] airport cache miss ${key}`);
    try {
      const data = await request(`/static/airports/${encodeURIComponent(key)}/light`);
      const airport = {
        name: cleanText(data.name),
        iata: cleanText(data.iata),
        icao: cleanText(data.icao)
      };
      await cache?.putAirport(key, airport);
      logger.log(`[route] airport cache insert ${key} (success)`);
      return airport;
    } catch (error) {
      logger.error(`[route] airport lookup failed ${key}: ${error.message}`);
      await cache?.putAirport(key, null);
      logger.log(`[route] airport cache insert ${key} (negative)`);
      return null;
    }
  }

  async function airlineDetails(icao) {
    if (!icao) {
      return null;
    }

    const key = icao.toUpperCase();
    const cached = await cache?.getAirline(key);
    if (cached) {
      logger.log(`[route] airline cache hit ${key} (${cached.success ? "success" : "negative"})`);
      return cached.value;
    }

    logger.log(`[route] airline cache miss ${key}`);
    try {
      const data = await request(`/static/airlines/${encodeURIComponent(key)}/light`);
      const name = cleanText(data.name);
      await cache?.putAirline(key, name);
      logger.log(`[route] airline cache insert ${key} (${name ? "success" : "negative"})`);
      return name;
    } catch (error) {
      logger.error(`[route] airline lookup failed ${key}: ${error.message}`);
      await cache?.putAirline(key, null);
      logger.log(`[route] airline cache insert ${key} (negative)`);
      return null;
    }
  }

  async function summaryLookup(callsign, registration) {
    const end = new Date(now() + 60 * 60 * 1000);
    const start = new Date(now() - 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      callsigns: callsign,
      registrations: registration,
      flight_datetime_from: utcParameter(start),
      flight_datetime_to: utcParameter(end),
      sort: "desc",
      limit: "5"
    });
    const data = await request(`/flight-summary/light?${params}`);
    return chooseLiveSummary(data, callsign, registration);
  }

  async function fullLookup(callsign, registration) {
    const params = new URLSearchParams({
      callsigns: callsign,
      limit: "5"
    });
    const data = await request(`/live/flight-positions/full?${params}`);
    return chooseFlight(data, callsign, registration);
  }

  async function lookup({ callsign, registration }) {
    if (!token) {
      return null;
    }

    let flight = null;
    let source = "full";

    if (routeMode === "summary-first") {
      flight = await summaryLookup(callsign, registration);
      source = "summary-light";
      if (!flight) {
        logger.log(`[route] summary-light miss ${callsign}; falling back to live full`);
      }
    }

    if (!flight) {
      flight = await fullLookup(callsign, registration);
      source = "live-full";
    }

    if (!flight || (!flight.orig_iata && !flight.orig_icao) || (!flight.dest_iata && !flight.dest_icao)) {
      return null;
    }

    const originCode = cleanText(flight.orig_iata) || cleanText(flight.orig_icao);
    const destinationCode = cleanText(flight.dest_iata) || cleanText(flight.dest_icao);
    const airlineIcao = cleanText(flight.operating_as);
    const [origin, destination, airlineName] = await Promise.all([
      airportDetails(originCode),
      airportDetails(destinationCode),
      airlineDetails(airlineIcao)
    ]);

    logger.log(`[route] route source ${callsign}: ${source}`);
    const timing = timingDetails(flight);
    return {
      callsign,
      origin: {
        iata: origin?.iata || cleanText(flight.orig_iata),
        icao: origin?.icao || cleanText(flight.orig_icao),
        name: origin?.name || null
      },
      destination: {
        iata: destination?.iata || cleanText(flight.dest_iata),
        icao: destination?.icao || cleanText(flight.dest_icao),
        name: destination?.name || null
      },
      airline: airlineName || airlineIcao,
      ...timing
    };
  }

  return { lookup, mode: routeMode };
}

module.exports = {
  chooseFlight,
  chooseLiveSummary,
  createFr24Provider,
  normalizeMode,
  normalizeTimestamp,
  timingDetails,
  utcParameter
};
