"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPhotoUrl, createPhotoService, normalizePhoto } = require("../src/photos");

test("builds a photo URL with uppercase hex and available aircraft hints", () => {
  assert.equal(
    buildPhotoUrl({
      hex: "ac5697",
      registration: "N8940Q",
      type: "B38M"
    }),
    "https://api.planespotters.net/pub/photos/hex/AC5697?reg=N8940Q&icaoType=B38M"
  );
});

test("normalizes the first large thumbnail and attribution", () => {
  assert.deepEqual(
    normalizePhoto({
      photos: [
        {
          thumbnail_large: { src: "https://cdn.example/photo.jpg" },
          link: "https://www.planespotters.net/photo/123",
          photographer: " Jane Doe "
        }
      ]
    }),
    {
      imageUrl: "https://cdn.example/photo.jpg",
      link: "https://www.planespotters.net/photo/123",
      photographer: "Jane Doe"
    }
  );
});

test("caches successful photo lookups by hex", async () => {
  let calls = 0;
  let requestHeaders;
  const service = createPhotoService({
    contact: "ops@example.com",
    fetchImpl: async (_url, options) => {
      calls += 1;
      requestHeaders = options.headers;
      return {
        ok: true,
        json: async () => ({
          photos: [
            {
              thumbnail: { src: "https://cdn.example/thumb.jpg" },
              link: "https://www.planespotters.net/photo/456",
              photographer: "A Photographer"
            }
          ]
        })
      };
    }
  });

  const aircraft = { hex: "ABC123", registration: "N123AB", type: "C172" };
  const first = await service.lookup(aircraft);
  const second = await service.lookup(aircraft);

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.match(requestHeaders["user-agent"], /AirAtlas\/6\.1/);
  assert.match(requestHeaders["user-agent"], /ops@example\.com/);
});

test("returns no photo without making a request when contact is not configured", async () => {
  let calls = 0;
  const service = createPhotoService({
    contact: "",
    fetchImpl: async () => {
      calls += 1;
    }
  });

  assert.equal(await service.lookup({ hex: "ABC123" }), null);
  assert.equal(calls, 0);
});
