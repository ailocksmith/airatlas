# AirAtlas

AirAtlas is a lightweight, full-screen nearest flight display for a Raspberry
Pi. It reads the Ultrafeeder `aircraft.json` feed, selects the most interesting
nearby aircraft, and presents it in a large aviation-themed kiosk view.

## What it does

- Polls Ultrafeeder every 5 seconds.
- Prefers aircraft with a valid receiver distance.
- Selects the nearest aircraft, using stronger RSSI as a tie-breaker when
  aircraft are within 0.5 nautical miles of each other.
- Shows flight number, type, registration, description, year, operator,
  altitude, speed, distance, signal, bearing, distance trend, feed count, and
  update time.
- Looks up an aircraft photo from Planespotters when an ICAO hex code is
  available, with photographer attribution and a link to the original photo.
- Caches photo results in memory so the same aircraft is not requested every
  five seconds.
- Enriches genuine airline callsigns with origin, destination, airport names,
  and airline information from the FlightRadar24 REST API.
- Shows provider-supplied route timing such as takeoff, first-seen, landed, or
  ETA when available. Times render in the browser display's local timezone.
- Stores direction-aware route lookups in a persistent SQLite cache: successful
  routes for 30 days and failed lookups for 12 hours.
- Tries Flight Summary Light first for route discovery, then falls back to Live
  Flight Positions Full when no reliable current match is found.
- Caches airport and airline metadata independently for 30 days, so recurring
  airports and operators do not consume another credit for every flight.
- Shows both the aircraft photo and bearing radar on large displays. Tablets
  and smaller screens retain a scaled photo or radar rather than hiding the
  visual card.
- Keeps the last aircraft visible during a temporary feed error.
- Shows `Scanning...` when the feed contains no aircraft.

## Why the Compose file uses host networking

Your Ultrafeeder port mapping is:

```text
Pi port 8080  --->  Ultrafeeder container port 80
```

Therefore, the feed is available on the Pi at:

```text
http://localhost:8080/data/aircraft.json
```

Inside a normal container, `localhost` means that container—not the Pi.
`network_mode: host` makes the AirAtlas container share the Pi's network
namespace, so `localhost:8080` reaches the published Ultrafeeder port.

Host networking is supported on Raspberry Pi OS/Linux. With this mode, the
application listens directly on Pi port 3000, so no `ports:` entry is needed.

## Install on the Raspberry Pi

Create a project directory:

```bash
mkdir -p ~/airatlas
cd ~/airatlas
```

Copy this project's files into that directory using SCP, SFTP, or your VNC
file-transfer method. The directory should look like:

```text
airatlas/
|-- .env.example
|-- compose.yaml
|-- Dockerfile
|-- package.json
|-- pnpm-lock.yaml
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
`-- src/
    |-- aircraft.js
    |-- photos.js
    |-- routes/
    |   |-- fr24-provider.js
    |   |-- route-provider.js
    |   `-- sqlite-route-cache.js
    `-- server.js
```

Create a `.env` file for local configuration. Planespotters requires a contact
email or contact URL in the server-side `User-Agent` so they can identify
legitimate applications:

```bash
cp .env.example .env
nano .env
```

Set the value:

```text
AIRCRAFT_URL=http://localhost:8080/data/aircraft.json
PLANESPOTTERS_CONTACT=your-real-email@example.com
FR24_API_TOKEN=your-fr24-api-token
```

The FR24 token remains inside the backend container. It is never included in
the browser API response or frontend JavaScript.

Build and start it:

```bash
docker compose up -d --build
```

## Use the published container image

After this project is published to GitHub and the container workflow has run,
you can use the GitHub Container Registry image instead of building locally.
Replace `YOUR-GITHUB-USER` with the repository owner:

```yaml
services:
  airatlas:
    image: ghcr.io/YOUR-GITHUB-USER/airatlas:latest
    container_name: airatlas
    restart: unless-stopped
    network_mode: host
    environment:
      PORT: "3000"
      AIRCRAFT_URL: "${AIRCRAFT_URL:-http://localhost:8080/data/aircraft.json}"
      POLL_INTERVAL_MS: "5000"
      FETCH_TIMEOUT_MS: "4000"
      PHOTO_TIMEOUT_MS: "4500"
      PLANESPOTTERS_CONTACT: "${PLANESPOTTERS_CONTACT:-}"
      ROUTE_TIMEOUT_MS: "5000"
      ROUTE_CACHE_PATH: "/app/data/routes.sqlite"
      FR24_API_TOKEN: "${FR24_API_TOKEN:-}"
      FR24_ROUTE_MODE: "${FR24_ROUTE_MODE:-summary-first}"
    volumes:
      - route-cache:/app/data

volumes:
  route-cache:
```

The workflow builds images for `linux/amd64`, `linux/arm64`, and
`linux/arm/v7`. The `linux/arm/v7` image is the important one for a 32-bit
Raspberry Pi 3B+ install.

Check its status and logs:

```bash
docker compose ps
docker compose logs -f airatlas
```

Open the display from another computer:

```text
http://192.168.4.21:3000
```

Substitute the Pi's current IP address if it changes.

## Chromium kiosk mode

On the Pi desktop, run:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:3000
```

Some Raspberry Pi OS versions name the executable `chromium` instead:

```bash
chromium --kiosk --noerrdialogs --disable-infobars http://localhost:3000
```

Press `Alt+F4` to leave kiosk mode.

## Configuration

The settings are environment variables. Values such as API tokens and the feed
URL should be set in `.env`; `compose.yaml` passes them into the container.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Web application port |
| `AIRCRAFT_URL` | `http://localhost:8080/data/aircraft.json` | Ultrafeeder feed |
| `POLL_INTERVAL_MS` | `5000` | Server polling interval |
| `FETCH_TIMEOUT_MS` | `4000` | Feed request timeout |
| `PHOTO_TIMEOUT_MS` | `4500` | Planespotters request timeout |
| `PLANESPOTTERS_CONTACT` | empty | Contact email or URL required for photos |
| `ROUTE_TIMEOUT_MS` | `5000` | Timeout for each FR24 request |
| `ROUTE_CACHE_PATH` | `/app/data/routes.sqlite` | Persistent SQLite cache file |
| `FR24_API_TOKEN` | empty | Backend-only FlightRadar24 REST API token |
| `FR24_ROUTE_MODE` | `summary-first` | Route strategy: `summary-first` or `full-only` |

After changing configuration, recreate the container:

```bash
docker compose up -d --build
```

## Useful commands

Restart:

```bash
docker compose restart
```

Stop:

```bash
docker compose down
```

Update after copying changed source files:

```bash
docker compose up -d --build
```

Check the application health endpoint:

```bash
curl http://localhost:3000/health
```

Check the Ultrafeeder source directly:

```bash
curl http://localhost:8080/data/aircraft.json
```

## Development

Install dependencies:

```bash
corepack enable
pnpm install
```

Run tests:

```bash
pnpm test
```

The Dockerfile uses `pnpm-lock.yaml` for reproducible production installs.

## Publishing containers

The GitHub Actions workflow in `.github/workflows/docker-publish.yml`:

- runs the Node.js test suite;
- builds a multi-architecture container image;
- publishes to GitHub Container Registry on pushes to `main` and version tags;
- builds pull requests without publishing an image.

Typical image name:

```text
ghcr.io/YOUR-GITHUB-USER/airatlas:latest
```

For a release tag such as `v6.1.0`, the workflow also publishes semver tags
such as `6.1.0` and `6.1`.

## Aircraft photos

Photo lookups use:

```text
https://api.planespotters.net/pub/photos/hex/{HEX}?reg={REG}&icaoType={TYPE}
```

The hex code is uppercased. Registration and ICAO type are included when
available. Photo lookup runs separately from the Ultrafeeder polling loop, so a
slow or unavailable photo service does not delay live aircraft updates.

Successful photo responses are cached for 24 hours. Empty results and failures
are cached for one hour to avoid repeatedly contacting the public service.
Image URLs are loaded directly by Chromium and are not downloaded, proxied, or
stored by AirAtlas. The returned photo link and visible photographer credit
are displayed with the image as required by the Planespotters API terms.

If `PLANESPOTTERS_CONTACT` is empty, aircraft data continues normally and the
photo card shows the no-photo fallback.

## Flight routes

Route enrichment uses the official FlightRadar24 REST API. A lookup is made
only when the featured aircraft has:

- A trimmed callsign.
- A registration.
- A callsign different from its registration.
- An airline-style ICAO callsign such as `SWA1341`, `DAL225`, or `AAL1047`.

General-aviation aircraft transmitting their registration as the callsign are
not queried. Only the single featured aircraft is considered; the application
never submits all aircraft in the Ultrafeeder feed.

An active FR24 API subscription and token are required. Relevant official
documentation:

- https://fr24api.flightradar24.com/docs/authentication
- https://fr24api.flightradar24.com/docs/endpoints/overview
- https://fr24api.flightradar24.com/docs/storage-rules

By default, the provider queries Flight Summary Light using both callsign and
registration over a narrow current-flight window. A result is accepted only
when:

- Callsign and registration both match the featured aircraft.
- `flight_ended` is not true.
- Origin and destination ICAO codes are present.

If no reliable current result is found, the provider automatically falls back
to Live Flight Positions Full. This preserves routes for airline, charter, and
private operator callsigns such as `CNS128`.

Flight Summary Light costs fewer credits and provides the route data the
display needs. Telemetry still comes from the local Ultrafeeder feed.

When available from the selected FR24 response, the route section also shows
authoritative timing labels:

- `TAKEOFF` from `datetime_takeoff`.
- `FIRST SEEN` from `first_seen` when takeoff time is unavailable.
- `LANDED` from `datetime_landed`.
- `ETA` from Live Flight Positions Full `eta`.

These timestamps are supplied by FR24 in UTC and displayed by the browser in
its local timezone. No separate timezone setting is required. The progress bar
is shown only if a provider returns an explicit progress percentage; the app
does not estimate progress from geography.

### Restore the original Full-only behavior

The v3 behavior is retained as a configuration mode. In `.env`, set:

```text
FR24_ROUTE_MODE=full-only
```

Then recreate the container:

```bash
docker compose up -d --build
```

This bypasses Summary Light and uses Live Flight Positions Full directly.

The provider is isolated under `src/routes/`, making it possible to replace
FR24 with another provider later without rewriting the display.

### Persistent cache

Route data is stored in the Docker volume `route-cache` at:

```text
/app/data/routes.sqlite
```

- Successful routes remain valid for 30 days.
- Failed or empty lookups remain valid for 12 hours.
- Airport and airline records are cached separately for 30 days.
- Failed airport and airline lookups are cached for 12 hours.
- Expired records are deleted automatically.
- A valid positive or negative cache entry prevents an FR24 request.

Route cache entries are keyed by callsign, registration, and a broad current
track bucket. That extra track bucket prevents a reused flight number from
showing a stale reciprocal route, such as `PNS -> ATL`, when the aircraft is
now flying the opposite direction, `ATL -> PNS`.

The cache survives container recreation. Running `docker compose down` keeps
it; running `docker compose down -v` deliberately deletes it.

### Route logging

Use:

```bash
docker compose logs -f airatlas
```

Route logs include cache hits, cache misses, FR24 requests, HTTP response
statuses, route source (`summary-light` or `live-full`), and positive or
negative cache inserts.

If `FR24_API_TOKEN` is empty, the aircraft display and photos continue working
and the route section stays hidden.

## Responsive display behavior

- At 1200 pixels wide and 650 pixels high or larger, a photo and bearing radar
  are shown together when a photo is available. The radar is a compact overlay
  so it no longer removes a large portion of the photo.
- On typical tablets and monitors, the photo is shown when available; otherwise
  the radar occupies the visual card.
- On screens 760 pixels wide or narrower, the visual card stacks below the
  aircraft details and scales down.
- On short landscape displays (600 pixels high or less), spacing and type sizes
  are reduced while the visual card remains visible.

Aircraft photos use `object-fit: contain`, preserving the complete image rather
than cropping it to fill the card.

Ground speed is displayed in knots and miles per hour. Receiver distance is
displayed in nautical miles and statute miles.

## Alternative: shared Docker network

If you later put both services on the same user-defined Docker network, set:

```yaml
AIRCRAFT_URL: "http://ultrafeeder:80/data/aircraft.json"
```

In that design, remove `network_mode: host`, add `ports: ["3000:3000"]`, and
attach both containers to the same network. The container name `ultrafeeder`
only resolves when the containers share a Docker network.
