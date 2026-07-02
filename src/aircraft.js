"use strict";

const SIMILAR_DISTANCE_MILES = 0.5;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAircraft(raw) {
  return {
    hex: cleanText(raw.hex)?.toUpperCase() || null,
    flight: cleanText(raw.flight),
    type: cleanText(raw.t),
    registration: cleanText(raw.r) || cleanText(raw.reg),
    description: cleanText(raw.desc),
    operator: cleanText(raw.ownOp),
    year: cleanText(raw.year),
    altitude: finiteNumber(raw.alt_baro),
    groundSpeed: finiteNumber(raw.gs),
    track: finiteNumber(raw.track),
    distance: finiteNumber(raw.r_dst),
    bearing: finiteNumber(raw.r_dir),
    signal: finiteNumber(raw.rssi)
  };
}

function selectAircraft(rawAircraft) {
  if (!Array.isArray(rawAircraft) || rawAircraft.length === 0) {
    return null;
  }

  const aircraft = rawAircraft.map(normalizeAircraft);
  const withDistance = aircraft.filter(({ distance }) => distance !== null && distance >= 0);

  if (withDistance.length > 0) {
    const nearestDistance = Math.min(...withDistance.map(({ distance }) => distance));
    const nearbyCandidates = withDistance.filter(
      ({ distance }) => distance <= nearestDistance + SIMILAR_DISTANCE_MILES
    );

    return nearbyCandidates.sort((a, b) => {
      const aSignal = a.signal ?? Number.NEGATIVE_INFINITY;
      const bSignal = b.signal ?? Number.NEGATIVE_INFINITY;
      return bSignal - aSignal || a.distance - b.distance;
    })[0];
  }

  return aircraft.sort((a, b) => {
    const aSignal = a.signal ?? Number.NEGATIVE_INFINITY;
    const bSignal = b.signal ?? Number.NEGATIVE_INFINITY;
    return bSignal - aSignal;
  })[0];
}

module.exports = {
  cleanText,
  normalizeAircraft,
  selectAircraft
};
