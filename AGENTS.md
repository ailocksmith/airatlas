# AirAtlas agent guide

This file is for AI coding agents and human contributors who want to understand
the project quickly before making changes.

## Project summary

AirAtlas is a lightweight Node.js/Express web app that displays the nearest or
most interesting aircraft from a local readsb/tar1090-compatible
`aircraft.json` feed. It is designed for kiosk-style displays, tablets, and
normal browsers on a local network.

The app:

- polls `AIRCRAFT_URL` every 5 seconds by default;
- selects one featured aircraft;
- enriches aircraft with readsb metadata, Planespotters photos, and optional
  FlightRadar24 route data;
- renders a full-screen dark aviation/radar-style display;
- runs as a Docker container on Raspberry Pi, ARM servers, x86 servers, or any
  Docker-capable host with access to the feed.

## Runtime and package manager

- Runtime: Node.js 20+
- Package manager: pnpm
- Package manager pin: see `packageManager` in `package.json`
- Test command: `pnpm test`
- Docker app port: `3000`

Do not require browser-side secrets. FR24 and other API tokens must stay on the
backend.

## Important files

- `src/server.js`
  - Express server.
  - Polls the aircraft feed.
  - Owns app state returned by `/api/aircraft` and `/api/route`.
  - Starts photo and route lookups asynchronously so the live aircraft refresh
    loop does not block on external APIs.

- `src/aircraft.js`
  - Normalizes readsb/tar1090 aircraft fields.
  - Selects the featured aircraft.
  - Keeps readsb naming conventions mapped to frontend-friendly names.

- `src/photos.js`
  - Looks up aircraft photos through the public Planespotters endpoint.
  - Requires `PLANESPOTTERS_CONTACT`.
  - Caches photo results in memory.
  - Does not proxy, download, or store images.

- `src/routes/route-provider.js`
  - Provider-neutral route lookup gatekeeper.
  - Decides route lookup eligibility.
  - Builds direction-aware cache keys from callsign, registration, and broad
    track bucket.
  - Coordinates cache-first behavior and pending request de-duplication.

- `src/routes/fr24-provider.js`
  - FlightRadar24 provider implementation.
  - Maps FR24 responses into the normalized route shape expected by the UI.
  - Supports `summary-first` and `full-only` modes.
  - Keep FR24-specific code here so another provider can be added cleanly.

- `src/routes/sqlite-route-cache.js`
  - Persistent SQLite route, airport, and airline metadata cache using `sql.js`.
  - Successful route lookups: 30-day TTL.
  - Failed route lookups: 12-hour TTL.
  - Includes schema migration logic. Be careful when changing column names.

- `public/app.js`
  - Browser-side rendering and polling.
  - Does not receive API tokens.

- `public/styles.css`
  - Responsive kiosk UI.
  - Large displays show aircraft photo and radar overlay together.
  - Smaller displays adapt rather than hiding the visual card completely.

- `.github/workflows/docker-publish.yml`
  - Runs tests.
  - Builds/publishes multi-arch images to GHCR.
  - Target platforms include `linux/amd64`, `linux/arm64`, and `linux/arm/v7`.

## Normalized aircraft shape

`normalizeAircraft()` maps raw readsb/tar1090 fields into:

```js
{
  hex,
  flight,
  type,
  registration,
  description,
  operator,
  year,
  altitude,
  groundSpeed,
  track,
  distance,
  bearing,
  signal
}
```

Important source fields:

- `flight`: callsign
- `r`: registration, preferred
- `reg`: older registration fallback
- `t`: ICAO aircraft type
- `desc`: aircraft description
- `ownOp`: owner/operator
- `year`: year built
- `r_dst`: receiver distance in nautical miles
- `r_dir`: bearing from receiver
- `rssi`: signal strength

## Featured aircraft selection

Selection prefers:

1. aircraft with valid `r_dst`;
2. lowest distance;
3. stronger RSSI when aircraft are within the similar-distance threshold.

If no aircraft have valid distance, the app falls back to strongest RSSI.

## Route provider contract

Frontend code expects a route object like:

```js
{
  callsign,
  origin: { iata, icao, name },
  destination: { iata, icao, name },
  airline,
  scheduledDeparture,
  scheduledDepartureLabel,
  scheduledArrival,
  scheduledArrivalLabel,
  progress
}
```

Fields may be `null`. The UI must handle missing data gracefully.

To add a provider such as FlightAware or AirLabs:

1. create a new provider file under `src/routes/`;
2. expose a `lookup({ callsign, registration })` function;
3. return the normalized route shape above;
4. keep provider secrets on the backend only;
5. use the existing cache layer where possible;
6. add tests for provider mapping, misses, and error handling.

Do not estimate route progress from aircraft geography unless the feature is
explicitly requested. Current behavior only shows progress if a provider returns
an explicit progress percentage.

## Caching rules

- Route cache is persistent SQLite at `ROUTE_CACHE_PATH`.
- Positive route cache TTL: 30 days.
- Negative route cache TTL: 12 hours.
- Airport and airline metadata caches use the same positive/negative TTLs.
- Cache keys include callsign, registration, and broad current track bucket to
  reduce stale reciprocal route display.
- API lookups should be attempted only for the currently featured aircraft.

## Environment variables

Common settings:

- `PORT`
- `AIRCRAFT_URL`
- `POLL_INTERVAL_MS`
- `FETCH_TIMEOUT_MS`
- `PHOTO_TIMEOUT_MS`
- `PLANESPOTTERS_CONTACT`
- `ROUTE_TIMEOUT_MS`
- `ROUTE_CACHE_PATH`
- `FR24_API_TOKEN`
- `FR24_ROUTE_MODE`

Never commit real `.env` files or API tokens.

## Testing expectations

Before handing off code changes, run:

```bash
pnpm test
```

If editing frontend JavaScript, also run a syntax check or load the UI locally
when possible. Add or update tests for:

- aircraft normalization/selection;
- photo URL/response mapping;
- route eligibility/cache behavior;
- provider response mapping;
- SQLite persistence and TTL behavior.

## Style and contribution notes

- Keep dependencies minimal.
- Keep external API calls asynchronous and non-blocking for the aircraft feed
  refresh loop.
- Handle missing fields with `null`/`—` rather than throwing.
- Keep provider-specific code isolated from frontend rendering.
- Preserve the dark, radar-inspired kiosk visual design.
- Be careful with Raspberry Pi compatibility and multi-arch Docker builds.
