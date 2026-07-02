"use strict";

const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");

const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 12 * 60 * 60 * 1000;

function valueOrNull(value) {
  return value === undefined ? null : value;
}

async function createSqliteRouteCache({
  filename,
  now = () => Date.now(),
  sqlJsFactory = initSqlJs
}) {
  const SQL = await sqlJsFactory({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
  });

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = fs.existsSync(filename)
    ? new SQL.Database(fs.readFileSync(filename))
    : new SQL.Database();

  createRouteCacheTable();
  migrateRouteCache();
  database.run(`
    CREATE TABLE IF NOT EXISTS airport_cache (
      code TEXT PRIMARY KEY,
      success INTEGER NOT NULL,
      name TEXT,
      iata TEXT,
      icao TEXT,
      lookup_timestamp INTEGER NOT NULL
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS airline_cache (
      icao TEXT PRIMARY KEY,
      success INTEGER NOT NULL,
      name TEXT,
      lookup_timestamp INTEGER NOT NULL
    )
  `);

  function createRouteCacheTable() {
    database.run(`
      CREATE TABLE IF NOT EXISTS route_cache (
        cache_key TEXT PRIMARY KEY,
        callsign TEXT NOT NULL,
        registration TEXT,
        success INTEGER NOT NULL,
        origin_icao TEXT,
        origin_iata TEXT,
        destination_icao TEXT,
        destination_iata TEXT,
        departure_airport_name TEXT,
        arrival_airport_name TEXT,
        airline TEXT,
        scheduled_departure TEXT,
        scheduled_departure_label TEXT,
        scheduled_arrival TEXT,
        scheduled_arrival_label TEXT,
        progress REAL,
        lookup_timestamp INTEGER NOT NULL
      )
    `);
  }

  function tableColumns(table) {
    const statement = database.prepare(`PRAGMA table_info(${table})`);
    const columns = [];
    while (statement.step()) {
      columns.push(statement.getAsObject());
    }
    statement.free();
    return columns;
  }

  function migrateRouteCache() {
    const columnInfo = tableColumns("route_cache");
    const columns = new Set(columnInfo.map((column) => column.name));
    const callsignColumn = columnInfo.find((column) => column.name === "callsign");
    const needsRebuild = !columns.has("cache_key") || callsignColumn?.pk > 0;

    if (needsRebuild) {
      const oldTable = `route_cache_old_${Date.now()}`;
      database.run(`ALTER TABLE route_cache RENAME TO ${oldTable}`);
      createRouteCacheTable();

      const oldColumns = new Set(tableColumns(oldTable).map((column) => column.name));
      const cacheKeyExpression = oldColumns.has("cache_key")
        ? "COALESCE(cache_key, callsign)"
        : "callsign";
      const registrationExpression = oldColumns.has("registration") ? "registration" : "NULL";

      database.run(`
        INSERT OR REPLACE INTO route_cache (
          cache_key, callsign, registration, success, origin_icao, origin_iata,
          destination_icao, destination_iata, departure_airport_name,
          arrival_airport_name, airline, scheduled_departure,
          scheduled_departure_label, scheduled_arrival,
          scheduled_arrival_label, progress, lookup_timestamp
        )
        SELECT
          ${cacheKeyExpression}, callsign, ${registrationExpression}, success,
          origin_icao, origin_iata, destination_icao, destination_iata,
          departure_airport_name, arrival_airport_name, airline,
          scheduled_departure, NULL, scheduled_arrival, NULL, progress,
          lookup_timestamp
        FROM ${oldTable}
      `);
      database.run(`DROP TABLE ${oldTable}`);
    }

    database.run("CREATE UNIQUE INDEX IF NOT EXISTS route_cache_cache_key_idx ON route_cache(cache_key)");
    const migratedColumns = new Set(tableColumns("route_cache").map((column) => column.name));
    if (!migratedColumns.has("registration")) {
      database.run("ALTER TABLE route_cache ADD COLUMN registration TEXT");
    }
    if (!migratedColumns.has("scheduled_departure_label")) {
      database.run("ALTER TABLE route_cache ADD COLUMN scheduled_departure_label TEXT");
    }
    if (!migratedColumns.has("scheduled_arrival_label")) {
      database.run("ALTER TABLE route_cache ADD COLUMN scheduled_arrival_label TEXT");
    }
    database.run("UPDATE route_cache SET cache_key = callsign WHERE cache_key IS NULL");
  }

  function prune() {
    const currentTime = now();
    database.run(
      `DELETE FROM route_cache
       WHERE (success = 1 AND lookup_timestamp <= ?)
          OR (success = 0 AND lookup_timestamp <= ?)`,
      [currentTime - SUCCESS_TTL_MS, currentTime - FAILURE_TTL_MS]
    );
    database.run(
      `DELETE FROM airport_cache
       WHERE (success = 1 AND lookup_timestamp <= ?)
          OR (success = 0 AND lookup_timestamp <= ?)`,
      [currentTime - SUCCESS_TTL_MS, currentTime - FAILURE_TTL_MS]
    );
    database.run(
      `DELETE FROM airline_cache
       WHERE (success = 1 AND lookup_timestamp <= ?)
          OR (success = 0 AND lookup_timestamp <= ?)`,
      [currentTime - SUCCESS_TTL_MS, currentTime - FAILURE_TTL_MS]
    );
    persist();
  }

  function persist() {
    const temporary = `${filename}.tmp`;
    fs.writeFileSync(temporary, Buffer.from(database.export()));
    try {
      fs.renameSync(temporary, filename);
    } catch (error) {
      if (process.platform !== "win32") {
        throw error;
      }
      fs.copyFileSync(temporary, filename);
      fs.unlinkSync(temporary);
    }
  }

  prune();
  setInterval(prune, 6 * 60 * 60 * 1000).unref();

  async function get(cacheKey) {
    const statement = database.prepare(
      "SELECT * FROM route_cache WHERE cache_key = ?"
    );
    statement.bind([cacheKey]);
    const row = statement.step() ? statement.getAsObject() : null;
    statement.free();

    if (!row) {
      return null;
    }

    const ttl = row.success ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (now() - Number(row.lookup_timestamp) >= ttl) {
      database.run("DELETE FROM route_cache WHERE cache_key = ?", [cacheKey]);
      persist();
      return null;
    }

    if (!row.success) {
      return { success: false, route: null };
    }

    return {
      success: true,
      route: {
        callsign: row.callsign,
        origin: {
          icao: row.origin_icao,
          iata: row.origin_iata,
          name: row.departure_airport_name
        },
        destination: {
          icao: row.destination_icao,
          iata: row.destination_iata,
          name: row.arrival_airport_name
        },
        airline: row.airline,
        scheduledDeparture: row.scheduled_departure,
        scheduledDepartureLabel: row.scheduled_departure_label,
        scheduledArrival: row.scheduled_arrival,
        scheduledArrivalLabel: row.scheduled_arrival_label,
        progress: row.progress
      }
    };
  }

  async function put(cacheKey, route, metadata = {}) {
    database.run(
      `INSERT OR REPLACE INTO route_cache (
        cache_key, callsign, registration, success, origin_icao, origin_iata, destination_icao,
        destination_iata, departure_airport_name, arrival_airport_name,
        airline, scheduled_departure, scheduled_departure_label,
        scheduled_arrival, scheduled_arrival_label, progress,
        lookup_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cacheKey,
        valueOrNull(metadata.callsign || route?.callsign || cacheKey),
        valueOrNull(metadata.registration),
        route ? 1 : 0,
        valueOrNull(route?.origin?.icao),
        valueOrNull(route?.origin?.iata),
        valueOrNull(route?.destination?.icao),
        valueOrNull(route?.destination?.iata),
        valueOrNull(route?.origin?.name),
        valueOrNull(route?.destination?.name),
        valueOrNull(route?.airline),
        valueOrNull(route?.scheduledDeparture),
        valueOrNull(route?.scheduledDepartureLabel),
        valueOrNull(route?.scheduledArrival),
        valueOrNull(route?.scheduledArrivalLabel),
        valueOrNull(route?.progress),
        now()
      ]
    );
    persist();
  }

  async function getAirport(code) {
    const statement = database.prepare(
      "SELECT * FROM airport_cache WHERE code = ?"
    );
    statement.bind([code]);
    const row = statement.step() ? statement.getAsObject() : null;
    statement.free();
    return readMetadataRow("airport_cache", "code", code, row, (value) => ({
      name: value.name,
      iata: value.iata,
      icao: value.icao
    }));
  }

  async function putAirport(code, airport) {
    database.run(
      `INSERT OR REPLACE INTO airport_cache
       (code, success, name, iata, icao, lookup_timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        code,
        airport ? 1 : 0,
        valueOrNull(airport?.name),
        valueOrNull(airport?.iata),
        valueOrNull(airport?.icao),
        now()
      ]
    );
    persist();
  }

  async function getAirline(icao) {
    const statement = database.prepare(
      "SELECT * FROM airline_cache WHERE icao = ?"
    );
    statement.bind([icao]);
    const row = statement.step() ? statement.getAsObject() : null;
    statement.free();
    return readMetadataRow("airline_cache", "icao", icao, row, (value) => value.name);
  }

  async function putAirline(icao, name) {
    database.run(
      `INSERT OR REPLACE INTO airline_cache
       (icao, success, name, lookup_timestamp)
       VALUES (?, ?, ?, ?)`,
      [icao, name ? 1 : 0, valueOrNull(name), now()]
    );
    persist();
  }

  function readMetadataRow(table, keyColumn, key, row, mapValue) {
    if (!row) {
      return null;
    }

    const ttl = row.success ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (now() - Number(row.lookup_timestamp) >= ttl) {
      database.run(`DELETE FROM ${table} WHERE ${keyColumn} = ?`, [key]);
      persist();
      return null;
    }

    return {
      success: Boolean(row.success),
      value: row.success ? mapValue(row) : null
    };
  }

  return {
    get,
    put,
    getAirport,
    putAirport,
    getAirline,
    putAirline
  };
}

module.exports = {
  FAILURE_TTL_MS,
  SUCCESS_TTL_MS,
  createSqliteRouteCache
};
