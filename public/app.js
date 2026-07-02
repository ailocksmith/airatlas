"use strict";

const elements = {
  aircraftPanel: document.querySelector("#aircraft-panel"),
  emptyPanel: document.querySelector("#empty-panel"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyMessage: document.querySelector("#empty-message"),
  statusDot: document.querySelector("#status-dot"),
  feedLabel: document.querySelector("#feed-label"),
  flight: document.querySelector("#flight"),
  type: document.querySelector("#type"),
  registration: document.querySelector("#registration"),
  routeSection: document.querySelector("#route-section"),
  routeLoading: document.querySelector("#route-loading"),
  routeOrigin: document.querySelector("#route-origin"),
  routeOriginCode: document.querySelector("#route-origin-code"),
  routeDestination: document.querySelector("#route-destination"),
  routeDestinationCode: document.querySelector("#route-destination-code"),
  routeAirline: document.querySelector("#route-airline"),
  routeDepartureTime: document.querySelector("#route-departure-time"),
  routeArrivalTime: document.querySelector("#route-arrival-time"),
  routeProgress: document.querySelector("#route-progress"),
  description: document.querySelector("#description"),
  operator: document.querySelector("#operator"),
  photoLink: document.querySelector("#photo-link"),
  aircraftPhoto: document.querySelector("#aircraft-photo"),
  photoAttribution: document.querySelector("#photo-attribution"),
  visualCard: document.querySelector(".visual-card"),
  photoFallback: document.querySelector("#photo-fallback"),
  photoFallbackLabel: document.querySelector("#photo-fallback-label"),
  altitude: document.querySelector("#altitude"),
  speed: document.querySelector("#speed"),
  speedMph: document.querySelector("#speed-mph"),
  distance: document.querySelector("#distance"),
  distanceMiles: document.querySelector("#distance-miles"),
  signal: document.querySelector("#signal"),
  bearing: document.querySelector("#bearing"),
  bearingPointers: document.querySelectorAll(".bearing-pointer"),
  trend: document.querySelector("#trend"),
  aircraftCount: document.querySelector("#aircraft-count"),
  lastUpdate: document.querySelector("#last-update")
};
let currentAircraftKey = "";

function displayNumber(value, options = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "\u2014";
  }
  return Number(value).toLocaleString(undefined, options);
}

function knotsToMph(value) {
  return Number.isFinite(Number(value)) ? Number(value) * 1.150779 : null;
}

function nauticalMilesToMiles(value) {
  return Number.isFinite(Number(value)) ? Number(value) * 1.150779 : null;
}

function airportCode(airport) {
  return airport?.iata || airport?.icao || "\u2014";
}

function airportName(airport) {
  return airport?.name || airportCode(airport);
}

function displayTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function updateRoute(routeState) {
  if (routeState.aircraftKey && routeState.aircraftKey !== currentAircraftKey) {
    return;
  }

  const route = routeState.route;
  elements.routeLoading.hidden = routeState.status !== "loading";

  if (!route) {
    elements.routeSection.hidden = true;
    return;
  }

  elements.routeSection.hidden = false;
  elements.routeLoading.hidden = true;
  elements.routeOrigin.textContent = airportName(route.origin);
  elements.routeOriginCode.textContent = airportCode(route.origin);
  elements.routeDestination.textContent = airportName(route.destination);
  elements.routeDestinationCode.textContent = airportCode(route.destination);

  elements.routeAirline.hidden = !route.airline;
  elements.routeAirline.textContent = route.airline || "";

  const departureTime = displayTime(route.scheduledDeparture);
  const arrivalTime = displayTime(route.scheduledArrival);
  const departureLabel = route.scheduledDepartureLabel || "SCHEDULED";
  const arrivalLabel = route.scheduledArrivalLabel || "SCHEDULED";
  elements.routeDepartureTime.hidden = !departureTime;
  elements.routeDepartureTime.textContent = departureTime ? `${departureLabel} ${departureTime}` : "";
  elements.routeArrivalTime.hidden = !arrivalTime;
  elements.routeArrivalTime.textContent = arrivalTime ? `${arrivalLabel} ${arrivalTime}` : "";

  const progress = Number(route.progress);
  const hasProgress = Number.isFinite(progress) && progress >= 0 && progress <= 100;
  elements.routeProgress.hidden = !hasProgress;
  if (hasProgress) {
    elements.routeProgress.querySelector("span").style.width = `${progress}%`;
  }
}

function updatePhoto(state) {
  const photo = state.photo;

  if (photo?.imageUrl && photo?.link) {
    elements.visualCard.classList.remove("no-photo");
    elements.photoLink.hidden = false;
    elements.photoFallback.hidden = true;
    elements.aircraftPhoto.src = photo.imageUrl;
    elements.aircraftPhoto.alt =
      `${state.aircraft.flight || state.aircraft.registration || "Aircraft"} photo`;
    elements.photoLink.href = photo.link;

    if (photo.photographer) {
      elements.photoAttribution.hidden = false;
      elements.photoAttribution.textContent = `PHOTO \u00A9 ${photo.photographer}`;
    } else {
      elements.photoAttribution.hidden = true;
      elements.photoAttribution.textContent = "";
    }
    return;
  }

  elements.photoLink.hidden = true;
  elements.visualCard.classList.add("no-photo");
  elements.photoAttribution.hidden = true;
  elements.photoFallback.hidden = false;
  elements.aircraftPhoto.removeAttribute("src");
  elements.photoLink.removeAttribute("href");
  elements.photoFallbackLabel.textContent =
    state.photoStatus === "loading" ? "SEARCHING FOR PHOTO" : "NO PHOTO AVAILABLE";
}

elements.aircraftPhoto.addEventListener("error", () => {
  elements.photoLink.hidden = true;
  elements.photoAttribution.hidden = true;
  elements.photoFallback.hidden = false;
  elements.visualCard.classList.add("no-photo");
  elements.photoFallbackLabel.textContent = "PHOTO UNAVAILABLE";
});

function updateAircraft(state) {
  const aircraft = state.aircraft;
  currentAircraftKey =
    `${aircraft.flight || ""}|${aircraft.registration || ""}`.toUpperCase();
  elements.aircraftPanel.hidden = false;
  elements.emptyPanel.hidden = true;
  elements.flight.textContent = aircraft.flight || aircraft.hex || "UNKNOWN";
  elements.type.textContent = `TYPE ${aircraft.type || "\u2014"}`;
  elements.registration.textContent = `REG ${aircraft.registration || "\u2014"}`;
  elements.description.textContent =
    `${aircraft.year ? `${aircraft.year} ` : ""}${aircraft.description || "\u2014"}`;
  elements.operator.textContent = aircraft.operator || "\u2014";
  elements.altitude.textContent = displayNumber(aircraft.altitude, { maximumFractionDigits: 0 });
  elements.speed.textContent = displayNumber(aircraft.groundSpeed, { maximumFractionDigits: 0 });
  elements.speedMph.textContent =
    `${displayNumber(knotsToMph(aircraft.groundSpeed), { maximumFractionDigits: 0 })} MPH`;
  elements.distance.textContent = displayNumber(aircraft.distance, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  elements.distanceMiles.textContent =
    `${displayNumber(nauticalMilesToMiles(aircraft.distance), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })} MI`;
  elements.signal.textContent = displayNumber(aircraft.signal, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  elements.bearing.textContent = displayNumber(aircraft.bearing, { maximumFractionDigits: 0 });

  const bearing = Number(aircraft.bearing);
  elements.bearingPointers.forEach((pointer) => {
    pointer.style.transform =
      Number.isFinite(bearing) ? `rotate(${bearing}deg)` : "rotate(0deg)";
    pointer.style.opacity = Number.isFinite(bearing) ? "1" : "0.25";
  });
  updatePhoto(state);
  updateRoute({
    aircraftKey: currentAircraftKey,
    route: state.route,
    status: state.routeStatus
  });

  if (state.trend) {
    elements.trend.hidden = false;
    elements.trend.textContent = state.trend;
    elements.trend.classList.toggle("departing", state.trend === "Departing");
  } else {
    elements.trend.hidden = true;
  }
}

function updateEmpty(state) {
  elements.aircraftPanel.hidden = true;
  elements.emptyPanel.hidden = false;

  if (state.status === "error") {
    elements.emptyTitle.textContent = "Signal interrupted";
    elements.emptyMessage.textContent =
      state.error || "The aircraft feed will be tried again automatically";
  } else {
    elements.emptyTitle.textContent = "Scanning...";
    elements.emptyMessage.textContent = "Searching the local sky for aircraft";
  }
}

function updateStatus(state) {
  elements.statusDot.className = "status-dot";
  elements.statusDot.classList.add(state.status === "online" ? "online" : state.status);
  elements.feedLabel.textContent =
    state.status === "online"
      ? "FEED ONLINE"
      : state.status === "error"
        ? "FEED DEGRADED"
        : state.status.toUpperCase();
  elements.aircraftCount.textContent = `${state.totalAircraft || 0} AIRCRAFT IN FEED`;

  if (state.updatedAt) {
    elements.lastUpdate.textContent =
      `UPDATED ${new Date(state.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })}`;
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/aircraft", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const state = await response.json();
    updateStatus(state);

    if (state.aircraft) {
      updateAircraft(state);
    } else {
      updateEmpty(state);
    }
  } catch (_error) {
    updateEmpty({
      status: "error",
      error: "The display server is temporarily unavailable"
    });
    updateStatus({ status: "error", totalAircraft: 0, updatedAt: new Date().toISOString() });
  }
}

async function refreshRoute() {
  try {
    const response = await fetch("/api/route", { cache: "no-store" });
    if (response.ok) {
      updateRoute(await response.json());
    }
  } catch (_error) {
    // Route enrichment is optional and must never disturb the aircraft display.
  }
}

refresh();
setInterval(refresh, 5000);
setInterval(refreshRoute, 1000);
