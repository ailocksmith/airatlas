"use strict";

const PHOTO_API_BASE = "https://api.planespotters.net/pub/photos/hex";
const SUCCESS_CACHE_MS = 24 * 60 * 60 * 1000;
const EMPTY_CACHE_MS = 60 * 60 * 1000;

function buildPhotoUrl(aircraft) {
  const hex = aircraft?.hex?.trim().toUpperCase();
  if (!hex) {
    return null;
  }

  const url = new URL(`${PHOTO_API_BASE}/${encodeURIComponent(hex)}`);
  if (aircraft.registration) {
    url.searchParams.set("reg", aircraft.registration);
  }
  if (aircraft.type) {
    url.searchParams.set("icaoType", aircraft.type);
  }
  return url.toString();
}

function normalizePhoto(data) {
  const photo = Array.isArray(data?.photos) ? data.photos[0] : null;
  const imageUrl = photo?.thumbnail_large?.src || photo?.thumbnail?.src;

  if (!photo || !imageUrl || !photo.link) {
    return null;
  }

  return {
    imageUrl,
    link: photo.link,
    photographer: typeof photo.photographer === "string" ? photo.photographer.trim() : null
  };
}

function createPhotoService({
  contact,
  timeoutMs = 4500,
  fetchImpl = fetch,
  now = () => Date.now()
}) {
  const cache = new Map();
  const pending = new Map();
  let warnedAboutContact = false;

  async function lookup(aircraft) {
    const hex = aircraft?.hex?.trim().toUpperCase();
    if (!hex) {
      return null;
    }

    const cached = cache.get(hex);
    if (cached && cached.expiresAt > now()) {
      return cached.photo;
    }

    if (!contact) {
      if (!warnedAboutContact) {
        warnedAboutContact = true;
        console.warn(
          "Aircraft photos disabled: set PLANESPOTTERS_CONTACT to a contact email or URL."
        );
      }
      cache.set(hex, { photo: null, expiresAt: now() + EMPTY_CACHE_MS });
      return null;
    }

    if (pending.has(hex)) {
      return pending.get(hex);
    }

    const request = (async () => {
      try {
        const response = await fetchImpl(buildPhotoUrl(aircraft), {
          headers: {
            accept: "application/json",
            "user-agent": `AirAtlas/6.1 (${contact})`
          },
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          throw new Error(`Planespotters returned HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data?.error) {
          throw new Error(`Planespotters: ${data.error}`);
        }

        const photo = normalizePhoto(data);
        cache.set(hex, {
          photo,
          expiresAt: now() + (photo ? SUCCESS_CACHE_MS : EMPTY_CACHE_MS)
        });
        return photo;
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Photo lookup failed for ${hex}: ${error.message}`);
        cache.set(hex, { photo: null, expiresAt: now() + EMPTY_CACHE_MS });
        return null;
      } finally {
        pending.delete(hex);
      }
    })();

    pending.set(hex, request);
    return request;
  }

  function getCached(hex) {
    const key = hex?.trim().toUpperCase();
    const cached = key ? cache.get(key) : null;
    return cached && cached.expiresAt > now() ? cached.photo : undefined;
  }

  return {
    getCached,
    lookup
  };
}

module.exports = {
  buildPhotoUrl,
  createPhotoService,
  normalizePhoto
};
