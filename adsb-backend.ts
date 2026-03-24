#!/usr/bin/env bun
// Minimum Bun version: 1.3.9 (uses bun:sqlite, Bun.serve)
/**
 * ADSB Dashboard Backend
 *
 * Standalone API server for ADSB tracking data.
 * - Fetches from ADSB.fi API on interval
 * - Stores military contacts in SQLite
 * - Manages watchlist, squawk alerts, and Pushover notifications
 * - Serves JSON API for the dashboard frontend
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const DB_PATH = process.env.ADSB_DB_PATH || "./data/adsb.db";
const PORT = Number(process.env.ADSB_PORT) || 8081;
const HOME_LAT = Number(process.env.ADSB_HOME_LAT) || 0;
const HOME_LON = Number(process.env.ADSB_HOME_LON) || 0;

// ── Database Setup ──────────────────────────────────────────────────────────

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS military_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hex TEXT NOT NULL,
    flight TEXT,
    registration TEXT,
    type_code TEXT,
    type_desc TEXT,
    owner_operator TEXT,
    callsign TEXT,
    alt_baro INTEGER,
    alt_geom INTEGER,
    ground_speed REAL,
    track REAL,
    lat REAL,
    lon REAL,
    distance_nm REAL,
    direction REAL,
    squawk TEXT,
    year TEXT,
    category TEXT,
    emergency TEXT,
    raw_json TEXT,
    first_seen DATETIME DEFAULT (datetime('now')),
    last_seen DATETIME DEFAULT (datetime('now')),
    session_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mil_hex ON military_contacts(hex);
  CREATE INDEX IF NOT EXISTS idx_mil_first_seen ON military_contacts(first_seen);
  CREATE INDEX IF NOT EXISTS idx_mil_session ON military_contacts(session_id);
  CREATE INDEX IF NOT EXISTS idx_mil_type ON military_contacts(type_code);

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_type TEXT NOT NULL CHECK(match_type IN ('hex', 'type', 'callsign', 'registration')),
    match_value TEXT NOT NULL,
    label TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(match_type, match_value)
  );

  CREATE TABLE IF NOT EXISTS watchlist_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id INTEGER NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
    hex TEXT NOT NULL,
    flight TEXT,
    type_code TEXT,
    type_desc TEXT,
    distance_nm REAL,
    alt_baro INTEGER,
    detected_at DATETIME DEFAULT (datetime('now')),
    dismissed INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_dismissed ON watchlist_alerts(dismissed);
  CREATE INDEX IF NOT EXISTS idx_alerts_detected ON watchlist_alerts(detected_at);

  CREATE TABLE IF NOT EXISTS squawk_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hex TEXT NOT NULL,
    flight TEXT,
    squawk TEXT NOT NULL,
    squawk_type TEXT NOT NULL,
    type_code TEXT,
    distance_nm REAL,
    alt_baro INTEGER,
    detected_at DATETIME DEFAULT (datetime('now')),
    dismissed INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_squawk_hex ON squawk_alerts(hex, squawk);
  CREATE INDEX IF NOT EXISTS idx_squawk_detected ON squawk_alerts(detected_at);
  CREATE INDEX IF NOT EXISTS idx_squawk_dismissed ON squawk_alerts(dismissed);

  CREATE TABLE IF NOT EXISTS track_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hex TEXT NOT NULL,
    lat REAL,
    lon REAL,
    alt_baro INTEGER,
    alt_geom INTEGER,
    ground_speed REAL,
    track REAL,
    distance_nm REAL,
    is_military INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_track_hex_ts ON track_history(hex, timestamp);
  CREATE INDEX IF NOT EXISTS idx_track_ts ON track_history(timestamp);

  CREATE TABLE IF NOT EXISTS orbit_detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hex TEXT NOT NULL,
    flight TEXT,
    type_code TEXT,
    type_desc TEXT,
    owner_operator TEXT,
    center_lat REAL,
    center_lon REAL,
    radius_nm REAL,
    start_time DATETIME NOT NULL,
    end_time DATETIME DEFAULT (datetime('now')),
    orbit_count INTEGER DEFAULT 1,
    min_alt INTEGER,
    max_alt INTEGER,
    distance_nm REAL,
    active INTEGER DEFAULT 1,
    notified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_orbit_hex ON orbit_detections(hex);
  CREATE INDEX IF NOT EXISTS idx_orbit_active ON orbit_detections(active);
  CREATE INDEX IF NOT EXISTS idx_orbit_start ON orbit_detections(start_time);

  CREATE TABLE IF NOT EXISTS aircraft_cache (
    hex TEXT PRIMARY KEY,
    flight TEXT,
    registration TEXT,
    type_code TEXT,
    type_desc TEXT,
    owner_operator TEXT,
    alt_baro INTEGER,
    alt_geom INTEGER,
    ground_speed REAL,
    track REAL,
    lat REAL,
    lon REAL,
    distance_nm REAL,
    direction REAL,
    squawk TEXT,
    is_military INTEGER DEFAULT 0,
    category TEXT,
    year TEXT,
    raw_json TEXT,
    updated_at DATETIME DEFAULT (datetime('now'))
  );
`);

// ── Default Settings ────────────────────────────────────────────────────────

const defaultSettings: Record<string, string> = {
  all_radius_nm: "5",
  mil_radius_nm: "50",
  squawk_radius_nm: "25",
  refresh_interval_sec: "30",
  home_lat: String(HOME_LAT),
  home_lon: String(HOME_LON),
  pushover_user_key: "",
  pushover_app_token: "",
  pushover_enabled: "0",
  watchlist_radius_nm: "50",
};

const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
const setSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");

for (const [key, value] of Object.entries(defaultSettings)) {
  const existing = getSetting.get(key) as { value: string } | null;
  if (!existing) {
    setSetting.run(key, value);
  }
}

function getSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

// ── Database Cleanup (TTL) ──────────────────────────────────────────────────

function cleanupOldRecords(): void {
  const tables = ["military_contacts", "watchlist_alerts", "squawk_alerts", "track_history"];
  for (const table of tables) {
    const timestampCol = table === "military_contacts" ? "first_seen" : table === "track_history" ? "timestamp" : "detected_at";
    const ttlDays = table === "track_history" ? 30 : 90;
    const result = db.prepare(
      `DELETE FROM ${table} WHERE ${timestampCol} < datetime('now', '-${ttlDays} days')`
    ).run();
    if (result.changes > 0) {
      console.log(`[Cleanup] Removed ${result.changes} old rows from ${table}`);
    }
  }

  // Mark stale orbits as inactive (no update in 10 minutes)
  db.prepare("UPDATE orbit_detections SET active = 0 WHERE active = 1 AND end_time < datetime('now', '-10 minutes')").run();
  // Clean old orbit detections
  const oldOrbits = db.prepare("DELETE FROM orbit_detections WHERE start_time < datetime('now', '-90 days')").run();
  if (oldOrbits.changes > 0) console.log(`[Cleanup] Removed ${oldOrbits.changes} old orbit detections`);

  // Clean dismissed alerts older than 30 days
  const dismissedCleanup = db.prepare(
    "DELETE FROM watchlist_alerts WHERE dismissed = 1 AND detected_at < datetime('now', '-30 days')"
  ).run();
  if (dismissedCleanup.changes > 0) console.log(`[Cleanup] Removed ${dismissedCleanup.changes} old dismissed watchlist alerts`);
  const dismissedSquawk = db.prepare(
    "DELETE FROM squawk_alerts WHERE dismissed = 1 AND detected_at < datetime('now', '-30 days')"
  ).run();
  if (dismissedSquawk.changes > 0) console.log(`[Cleanup] Removed ${dismissedSquawk.changes} old dismissed squawk alerts`);

  // Periodic database backup
  try {
    const backupPath = process.env.ADSB_BACKUP_PATH || "./data/adsb-db-backup.db";
    db.exec(`VACUUM INTO '${backupPath}'`);
    console.log(`[Backup] Database backed up to ${backupPath}`);
  } catch (err: any) {
    console.error(`[Backup] Failed: ${err.message}`);
  }

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

// Run cleanup on startup and every 24 hours
cleanupOldRecords();
setInterval(cleanupOldRecords, 24 * 60 * 60 * 1000);

// ── Emergency Squawk Codes ──────────────────────────────────────────────────

const EMERGENCY_SQUAWKS: Record<string, { label: string; priority: number }> = {
  "7500": { label: "HIJACK",     priority: 1 },
  "7600": { label: "NORDO",      priority: 0 },
  "7700": { label: "EMERGENCY",  priority: 1 },
  // 7777 INTERCEPT — elevated to priority 1. Note: higher false-positive rate from routine military use
  "7777": { label: "INTERCEPT",  priority: 1 },
};

// ── Wikipedia URL mapping ───────────────────────────────────────────────────

const wikiMap: Record<string, string> = {
  "B52": "https://en.wikipedia.org/wiki/Boeing_B-52_Stratofortress",
  "B1": "https://en.wikipedia.org/wiki/Rockwell_B-1_Lancer",
  "B2": "https://en.wikipedia.org/wiki/Northrop_Grumman_B-2_Spirit",
  "B21": "https://en.wikipedia.org/wiki/Northrop_Grumman_B-21_Raider",
  "F16": "https://en.wikipedia.org/wiki/General_Dynamics_F-16_Fighting_Falcon",
  "F15": "https://en.wikipedia.org/wiki/McDonnell_Douglas_F-15_Eagle",
  "F18": "https://en.wikipedia.org/wiki/McDonnell_Douglas_F/A-18_Hornet",
  "FA18": "https://en.wikipedia.org/wiki/McDonnell_Douglas_F/A-18_Hornet",
  "F22": "https://en.wikipedia.org/wiki/Lockheed_Martin_F-22_Raptor",
  "F35": "https://en.wikipedia.org/wiki/Lockheed_Martin_F-35_Lightning_II",
  "C130": "https://en.wikipedia.org/wiki/Lockheed_C-130_Hercules",
  "C17": "https://en.wikipedia.org/wiki/Boeing_C-17_Globemaster_III",
  "C5": "https://en.wikipedia.org/wiki/Lockheed_C-5_Galaxy",
  "C5M": "https://en.wikipedia.org/wiki/Lockheed_C-5_Galaxy",
  "C27J": "https://en.wikipedia.org/wiki/Alenia_C-27J_Spartan",
  "KC135": "https://en.wikipedia.org/wiki/Boeing_KC-135_Stratotanker",
  "KC46": "https://en.wikipedia.org/wiki/Boeing_KC-46_Pegasus",
  "KC10": "https://en.wikipedia.org/wiki/McDonnell_Douglas_KC-10_Extender",
  "E3": "https://en.wikipedia.org/wiki/Boeing_E-3_Sentry",
  "E6": "https://en.wikipedia.org/wiki/Boeing_E-6_Mercury",
  "E8": "https://en.wikipedia.org/wiki/Northrop_Grumman_E-8_Joint_STARS",
  "RC135": "https://en.wikipedia.org/wiki/Boeing_RC-135",
  "RC26": "https://en.wikipedia.org/wiki/Fairchild_C-26_Metroliner",
  "P8": "https://en.wikipedia.org/wiki/Boeing_P-8_Poseidon",
  "P3": "https://en.wikipedia.org/wiki/Lockheed_P-3_Orion",
  "H60": "https://en.wikipedia.org/wiki/Sikorsky_UH-60_Black_Hawk",
  "H47": "https://en.wikipedia.org/wiki/Boeing_CH-47_Chinook",
  "H1": "https://en.wikipedia.org/wiki/Bell_UH-1_Iroquois",
  "AH64": "https://en.wikipedia.org/wiki/Boeing_AH-64_Apache",
  "V22": "https://en.wikipedia.org/wiki/Bell_Boeing_V-22_Osprey",
  "A10": "https://en.wikipedia.org/wiki/Fairchild_Republic_A-10_Thunderbolt_II",
  "U2": "https://en.wikipedia.org/wiki/Lockheed_U-2",
  "RQ4": "https://en.wikipedia.org/wiki/Northrop_Grumman_RQ-4_Global_Hawk",
  "MQ9": "https://en.wikipedia.org/wiki/General_Atomics_MQ-9_Reaper",
  "MQ1": "https://en.wikipedia.org/wiki/General_Atomics_MQ-1_Predator",
  "T38": "https://en.wikipedia.org/wiki/Northrop_T-38_Talon",
  "T6": "https://en.wikipedia.org/wiki/Beechcraft_T-6_Texan_II",
  "AS65": "https://en.wikipedia.org/wiki/Eurocopter_HH-65_Dolphin",
  "C40": "https://en.wikipedia.org/wiki/Boeing_C-40_Clipper",
  "C12": "https://en.wikipedia.org/wiki/Beechcraft_C-12_Huron",
  "C37": "https://en.wikipedia.org/wiki/Gulfstream_V",
  "C32": "https://en.wikipedia.org/wiki/Boeing_C-32",
  "VC25": "https://en.wikipedia.org/wiki/Boeing_VC-25",
  "E4": "https://en.wikipedia.org/wiki/Boeing_E-4",
  "MC12": "https://en.wikipedia.org/wiki/Beechcraft_MC-12_Liberty",
  "CV22": "https://en.wikipedia.org/wiki/Bell_Boeing_V-22_Osprey",
  "AC130": "https://en.wikipedia.org/wiki/Lockheed_AC-130",
  "HC130": "https://en.wikipedia.org/wiki/Lockheed_HC-130",
  "MC130": "https://en.wikipedia.org/wiki/Lockheed_MC-130",
  "WC130": "https://en.wikipedia.org/wiki/Lockheed_WC-130",
  "EC130": "https://en.wikipedia.org/wiki/Lockheed_EC-130",
};

function getWikiUrl(typeCode: string, desc: string): string {
  if (!typeCode) return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(desc || "military aircraft")}`;
  const upper = typeCode.toUpperCase();
  if (wikiMap[upper]) return wikiMap[upper];
  for (const [key, url] of Object.entries(wikiMap)) {
    if (upper.startsWith(key) || key.startsWith(upper)) return url;
  }
  return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(desc || typeCode)}`;
}

function getAdsbTrackUrl(hex: string): string {
  return `https://globe.adsb.fi/?icao=${hex}`;
}

// ── Pushover Notifications ──────────────────────────────────────────────────

async function sendPushover(title: string, message: string, url?: string, priority = 0): Promise<void> {
  const settings = getSettings();
  if (settings.pushover_enabled !== "1") return;
  const userKey = settings.pushover_user_key;
  const appToken = settings.pushover_app_token;
  if (!userKey || !appToken) return;

  try {
    const body: Record<string, any> = {
      token: appToken,
      user: userKey,
      title,
      message,
      priority,
    };
    if (url) {
      body.url = url;
      body.url_title = "Track on ADSB.fi";
    }

    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Pushover] Failed (${res.status}): ${text}`);
    } else {
      console.log(`[Pushover] Sent: "${title}"`);
    }
  } catch (err: any) {
    console.error(`[Pushover] Error: ${err.message}`);
  }
}

// ── ADSB.fi API Fetcher ─────────────────────────────────────────────────────

interface ADSBAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  dbFlags?: number;
  ownOp?: string;
  year?: string;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
  dst?: number;
  dir?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  [key: string]: any;
}

let lastFetchTime = 0;
let currentAircraft: ADSBAircraft[] = [];
let currentMilitary: ADSBAircraft[] = [];
let fetchError: string | null = null;
let consecutiveFailures = 0;

// ── Prepared Statements (hoisted for performance) ─────────────────────────
const stmtMilRecent = db.prepare("SELECT id FROM military_contacts WHERE hex = ? AND last_seen > datetime('now', '-10 minutes')");
const stmtMilUpdate = db.prepare(`
  UPDATE military_contacts SET
    last_seen = datetime('now'), lat = ?, lon = ?, distance_nm = ?,
    alt_baro = ?, ground_speed = ?, track = ?, direction = ?,
    flight = COALESCE(?, flight), raw_json = ?
  WHERE id = ?
`);
const stmtWatchAll = db.prepare("SELECT * FROM watchlist");
const stmtWatchRecentAlert = db.prepare("SELECT id FROM watchlist_alerts WHERE watchlist_id = ? AND hex = ? AND detected_at > datetime('now', '-10 minutes')");
const stmtWatchInsertAlert = db.prepare(`INSERT INTO watchlist_alerts (watchlist_id, hex, flight, type_code, type_desc, distance_nm, alt_baro) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const stmtSquawkRecent = db.prepare("SELECT id FROM squawk_alerts WHERE hex = ? AND squawk = ? AND detected_at > datetime('now', '-15 minutes')");
const stmtSquawkInsert = db.prepare(`INSERT INTO squawk_alerts (hex, flight, squawk, squawk_type, type_code, distance_nm, alt_baro) VALUES (?, ?, ?, ?, ?, ?, ?)`);

// ── Track History & Orbit Detection ──────────────────────────────────────
const stmtTrackInsert = db.prepare(`
  INSERT INTO track_history (hex, lat, lon, alt_baro, alt_geom, ground_speed, track, distance_nm, is_military)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtTrackRecent = db.prepare(`
  SELECT lat, lon, track, alt_baro, timestamp FROM track_history
  WHERE hex = ? AND timestamp > datetime('now', '-15 minutes')
  ORDER BY timestamp ASC
`);
const stmtOrbitActive = db.prepare("SELECT * FROM orbit_detections WHERE hex = ? AND active = 1");
const stmtOrbitInsert = db.prepare(`
  INSERT INTO orbit_detections (hex, flight, type_code, type_desc, owner_operator, center_lat, center_lon, radius_nm, start_time, end_time, orbit_count, min_alt, max_alt, distance_nm)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)
`);
const stmtOrbitUpdate = db.prepare(`
  UPDATE orbit_detections SET end_time = datetime('now'), orbit_count = ?, center_lat = ?, center_lon = ?,
  radius_nm = ?, min_alt = ?, max_alt = ?, flight = COALESCE(?, flight) WHERE id = ?
`);

// Compute cumulative heading change from a series of track (heading) values
function computeCumulativeHeadingChange(tracks: { track: number }[]): number {
  let total = 0;
  for (let i = 1; i < tracks.length; i++) {
    let delta = tracks[i].track - tracks[i - 1].track;
    // Normalize to [-180, 180]
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    total += delta;
  }
  return Math.abs(total);
}

// Compute centroid and average radius from positions
function computeOrbitGeometry(positions: { lat: number; lon: number }[]): { centerLat: number; centerLon: number; radiusNm: number } {
  const centerLat = positions.reduce((s, p) => s + p.lat, 0) / positions.length;
  const centerLon = positions.reduce((s, p) => s + p.lon, 0) / positions.length;
  // Approximate NM distance from centroid
  const distances = positions.map(p => {
    const dLat = (p.lat - centerLat) * 60; // degrees to NM
    const dLon = (p.lon - centerLon) * 60 * Math.cos(centerLat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  });
  const radiusNm = distances.reduce((s, d) => s + d, 0) / distances.length;
  return { centerLat, centerLon, radiusNm };
}

// Detect orbits for aircraft with sufficient track history
function detectOrbits(allAc: ADSBAircraft[], pendingNotifications: Array<{ title: string; message: string; url: string; priority: number }>): void {
  // Get all hex codes with recent track data (at least 5 minutes = ~10 points at 30s intervals)
  const candidates = db.prepare(`
    SELECT DISTINCT hex FROM track_history
    WHERE timestamp > datetime('now', '-15 minutes')
    GROUP BY hex HAVING COUNT(*) >= 10
  `).all() as { hex: string }[];

  for (const { hex } of candidates) {
    const points = stmtTrackRecent.all(hex) as { lat: number; lon: number; track: number; alt_baro: number | null; timestamp: string }[];
    // Filter out points without valid track data
    const validPoints = points.filter(p => p.track != null && p.lat != null && p.lon != null);
    if (validPoints.length < 10) continue;

    const headingChange = computeCumulativeHeadingChange(validPoints);
    const orbitCount = Math.floor(headingChange / 360);

    if (headingChange < 270) {
      // Not orbiting — mark any active orbit as complete
      const active = stmtOrbitActive.get(hex) as any;
      if (active) {
        db.prepare("UPDATE orbit_detections SET active = 0, end_time = datetime('now') WHERE id = ?").run(active.id);
        console.log(`[Orbit] Completed: ${hex} after ${active.orbit_count} orbits`);
      }
      continue;
    }

    // Aircraft is orbiting
    const geo = computeOrbitGeometry(validPoints);
    const alts = validPoints.filter(p => p.alt_baro != null).map(p => p.alt_baro!);
    const minAlt = alts.length > 0 ? Math.min(...alts) : null;
    const maxAlt = alts.length > 0 ? Math.max(...alts) : null;

    // Look up aircraft info from cache
    const acInfo = db.prepare("SELECT * FROM aircraft_cache WHERE hex = ?").get(hex) as any;
    const flight = acInfo?.flight?.trim() || null;
    const typeCode = acInfo?.type_code || null;
    const typeDesc = acInfo?.type_desc || null;
    const ownOp = acInfo?.owner_operator || null;
    const distNm = acInfo?.distance_nm || null;

    const activeOrbit = stmtOrbitActive.get(hex) as any;
    if (activeOrbit) {
      // Update existing orbit
      stmtOrbitUpdate.run(
        Math.max(orbitCount, activeOrbit.orbit_count), geo.centerLat, geo.centerLon,
        Math.round(geo.radiusNm * 10) / 10, minAlt, maxAlt, flight, activeOrbit.id
      );
    } else {
      // New orbit detected
      const startTime = validPoints[0].timestamp;
      stmtOrbitInsert.run(
        hex, flight, typeCode, typeDesc, ownOp,
        geo.centerLat, geo.centerLon, Math.round(geo.radiusNm * 10) / 10,
        startTime, Math.max(1, orbitCount), minAlt, maxAlt, distNm
      );

      const callsign = flight || hex.toUpperCase();
      const type = typeDesc || typeCode || "Unknown";
      const dist = distNm != null ? `${distNm.toFixed(1)} NM` : "unknown distance";
      const altStr = minAlt != null && maxAlt != null ? ` at ${minAlt}-${maxAlt}ft` : "";
      const isMil = acInfo?.is_military === 1;

      // Only send Pushover alerts for military aircraft orbits
      if (isMil) {
        const wikiUrl = getWikiUrl(typeCode || "", typeDesc || "");
        pendingNotifications.push({
          title: `ORBIT: ${callsign}`,
          message: `${callsign} (${type}) orbiting${altStr}, ${dist} away. ${orbitCount}+ orbit(s).\n${wikiUrl}`,
          url: getAdsbTrackUrl(hex),
          priority: 0,
        });
      }
      console.log(`[Orbit] Detected: ${callsign} (${type})${isMil ? ' [MIL]' : ''} orbiting at ${geo.centerLat.toFixed(3)}, ${geo.centerLon.toFixed(3)}, radius ${geo.radiusNm.toFixed(1)}NM`);
    }
  }
}

async function fetchADSBData(): Promise<void> {
  const settings = getSettings();
  const allRadius = Number(settings.all_radius_nm) || 5;
  const milRadius = Number(settings.mil_radius_nm) || 50;
  const squawkRadius = Number(settings.squawk_radius_nm) || 25;
  const lat = Number(settings.home_lat) || HOME_LAT;
  const lon = Number(settings.home_lon) || HOME_LON;

  const maxRadius = Math.max(allRadius, milRadius, squawkRadius);

  try {
    const url = `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${maxRadius}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) throw new Error(`ADSB API error: ${resp.status}`);

    const data = await resp.json() as { ac: ADSBAircraft[] };
    if (!data || !Array.isArray(data.ac)) {
      throw new Error(`Unexpected ADSB API response shape: missing ac array`);
    }
    const allAc = data.ac || [];

    const filteredAircraft = allAc.filter(ac => (ac.dst ?? 999) <= allRadius);

    const militaryInRadius = allAc.filter(ac => {
      const isMil = (ac.dbFlags && (ac.dbFlags & 1)) || false;
      const inMilRadius = (ac.dst ?? 999) <= milRadius;
      return isMil && inMilRadius;
    });

    const upsertCache = db.prepare(`
      INSERT OR REPLACE INTO aircraft_cache
      (hex, flight, registration, type_code, type_desc, owner_operator, alt_baro, alt_geom,
       ground_speed, track, lat, lon, distance_nm, direction, squawk, is_military, category, year, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // raw_json: denormalized for debugging — full API response preserved alongside extracted columns
    const insertMil = db.prepare(`
      INSERT INTO military_contacts
      (hex, flight, registration, type_code, type_desc, owner_operator, callsign, alt_baro, alt_geom,
       ground_speed, track, lat, lon, distance_nm, direction, squawk, year, category, emergency, raw_json, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Intentional: groups all military contacts from the same fetch cycle
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);

    // Collect notifications to send after transaction (async can't run inside sync transaction)
    const pendingNotifications: Array<{ title: string; message: string; url: string; priority: number }> = [];

    const updateTransaction = db.transaction(() => {
      // Full cache rebuild each cycle — acceptable with WAL mode (atomic, no read blocking).
      // Upsert alternative adds complexity without meaningful benefit at this data volume.
      db.exec("DELETE FROM aircraft_cache");

      for (const ac of allAc) {
        if ((ac.dst ?? 999) > maxRadius) continue;
        const isMil = (ac.dbFlags && (ac.dbFlags & 1)) ? 1 : 0;
        // alt_baro can be string "ground" from ADSB.fi — typeof check handles this
        const altBaro = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;

        upsertCache.run(
          ac.hex, ac.flight?.trim() || null, ac.r || null, ac.t || null, ac.desc || null,
          ac.ownOp || null, altBaro, ac.alt_geom ?? null,
          ac.gs ?? null, ac.track ?? null, ac.lat ?? null, ac.lon ?? null,
          ac.dst ?? null, ac.dir ?? null, ac.squawk || null, isMil,
          ac.category || null, ac.year || null, JSON.stringify(ac)
        );
      }

      // Log military contacts
      for (const ac of militaryInRadius) {
        const altBaro = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;

        const recent = stmtMilRecent.get(ac.hex) as { id: number } | null;

        if (recent) {
          stmtMilUpdate.run(ac.lat ?? null, ac.lon ?? null, ac.dst ?? null, altBaro, ac.gs ?? null, ac.track ?? null, ac.dir ?? null, ac.flight?.trim(), JSON.stringify(ac), recent.id);
        } else {
          insertMil.run(
            ac.hex, ac.flight?.trim() || null, ac.r || null, ac.t || null, ac.desc || null,
            ac.ownOp || null, ac.flight?.trim() || null, altBaro, ac.alt_geom ?? null,
            ac.gs ?? null, ac.track ?? null, ac.lat ?? null, ac.lon ?? null,
            ac.dst ?? null, ac.dir ?? null, ac.squawk || null, ac.year || null,
            ac.category || null, ac.emergency || null, JSON.stringify(ac), sessionId
          );
        }
      }

      // Check watchlist matches
      // Callsign uses substring match (includes) — intentional, allows partial matching
      // e.g., "EVAC" matches "EVAC01", "EVAC02". Other match types use exact match.
      // Minimum 2-char callsign enforced by frontend input validation.
      const watchItems = stmtWatchAll.all() as any[];
      const watchRadius = Number(settings.watchlist_radius_nm) || 50;
      for (const item of watchItems) {
        for (const ac of allAc) {
          if ((ac.dst ?? 999) > watchRadius) continue;
          let matched = false;
          if (item.match_type === 'hex' && ac.hex?.toLowerCase() === item.match_value.toLowerCase()) matched = true;
          if (item.match_type === 'type' && ac.t?.toLowerCase() === item.match_value.toLowerCase()) matched = true;
          if (item.match_type === 'callsign' && ac.flight?.trim()?.toLowerCase().includes(item.match_value.toLowerCase())) matched = true;
          if (item.match_type === 'registration' && ac.r?.toLowerCase() === item.match_value.toLowerCase()) matched = true;

          if (matched) {
            // 10-minute dedup window — prevents re-alerting for same aircraft.
            // Orbiting aircraft will re-trigger after window expires.
            const recentAlert = stmtWatchRecentAlert.get(item.id, ac.hex);

            if (!recentAlert) {
              const altBaro = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
              stmtWatchInsertAlert.run(item.id, ac.hex, ac.flight?.trim(), ac.t, ac.desc, ac.dst, altBaro);

              // Queue Pushover notification for watchlist match
              const callsign = ac.flight?.trim() || ac.hex.toUpperCase();
              const dist = ac.dst != null ? `${ac.dst.toFixed(1)} NM` : "unknown distance";
              const label = item.label || `${item.match_type}:${item.match_value}`;
              pendingNotifications.push({
                title: `Watchlist: ${label}`,
                message: `${callsign} (${ac.t || "Unknown"}) detected at ${dist}`,
                url: getAdsbTrackUrl(ac.hex),
                priority: 0,
              });
            }
          }
        }
      }

      // ── Track History (store every position report) ──────────────────────
      for (const ac of allAc) {
        if ((ac.dst ?? 999) > maxRadius) continue;
        if (ac.lat == null || ac.lon == null) continue;
        const isMil = (ac.dbFlags && (ac.dbFlags & 1)) ? 1 : 0;
        const altBaro2 = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
        stmtTrackInsert.run(
          ac.hex, ac.lat, ac.lon, altBaro2, ac.alt_geom ?? null,
          ac.gs ?? null, ac.track ?? null, ac.dst ?? null, isMil
        );
      }

      // ── Squawk Code Detection (inside transaction for atomicity) ──────────
      for (const ac of allAc) {
        if ((ac.dst ?? 999) > squawkRadius) continue;
        if (!ac.squawk) continue;
        const squawkInfo = EMERGENCY_SQUAWKS[ac.squawk];
        if (!squawkInfo) continue;

        const recentSquawk = stmtSquawkRecent.get(ac.hex, ac.squawk) as { id: number } | null;

        if (!recentSquawk) {
          const altBaro = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
          stmtSquawkInsert.run(
            ac.hex, ac.flight?.trim() || null, ac.squawk, squawkInfo.label,
            ac.t || null, ac.dst ?? null, altBaro
          );

          const callsign = ac.flight?.trim() || ac.hex.toUpperCase();
          const dist = ac.dst != null ? `${ac.dst.toFixed(1)} NM` : "unknown distance";
          pendingNotifications.push({
            title: `SQUAWK ${ac.squawk}: ${squawkInfo.label}`,
            message: `${callsign} (${ac.t || "Unknown"}) squawking ${ac.squawk} at ${dist}`,
            url: getAdsbTrackUrl(ac.hex),
            priority: squawkInfo.priority,
          });
        }
      }
    });

    updateTransaction();

    // ── Orbit Detection (runs after transaction so track_history is populated) ──
    try {
      detectOrbits(allAc, pendingNotifications);
    } catch (err: any) {
      console.error(`[Orbit] Detection error: ${err.message}`);
    }

    currentAircraft = filteredAircraft;
    currentMilitary = militaryInRadius;
    // Cap in-memory arrays to prevent excessive memory at wide radius settings
    if (currentAircraft.length > 500) {
      currentAircraft = currentAircraft.sort((a, b) => (a.dst ?? 999) - (b.dst ?? 999)).slice(0, 500);
    }
    lastFetchTime = Date.now();
    fetchError = null;
    consecutiveFailures = 0;

    // ── Send all queued Pushover notifications ──────────────────────────────
    for (const notif of pendingNotifications) {
      await sendPushover(notif.title, notif.message, notif.url, notif.priority);
    }

    console.log(`[${new Date().toISOString()}] Fetched: ${allAc.length} total, ${currentAircraft.length} in ${allRadius}NM, ${militaryInRadius.length} military in ${milRadius}NM, squawk watch ${squawkRadius}NM`);

  } catch (err: any) {
    consecutiveFailures++;
    fetchError = err.message;
    console.error(`[${new Date().toISOString()}] Fetch error (${consecutiveFailures} consecutive): ${err.message}`);

    if (consecutiveFailures >= 3) {
      currentAircraft = [];
      currentMilitary = [];
      fetchError = `${err.message} (stale data cleared after ${consecutiveFailures} failures)`;
      console.warn(`[${new Date().toISOString()}] Cleared stale aircraft data after ${consecutiveFailures} consecutive failures`);
    }
  }
}

// ── API Server ──────────────────────────────────────────────────────────────

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowed =
    /^https?:\/\/(10\.0\.2\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed ? { "Access-Control-Allow-Origin": origin } : {};
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...getCorsHeaders(req),
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ── GET /api/adsb/healthz ────────────────────────────────────────────
    if (path === "/api/adsb/healthz") {
      return Response.json({
        status: "ok",
        uptime: Math.round(process.uptime()),
        lastFetch: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
        consecutiveFailures,
        dbPath: DB_PATH,
      }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/status ─────────────────────────────────────────────
    if (path === "/api/adsb/status") {
      const settings = getSettings();
      const activeAlerts = db.prepare(
        "SELECT COUNT(*) as count FROM watchlist_alerts WHERE dismissed = 0"
      ).get() as { count: number };
      const activeSquawkAlerts = db.prepare(
        "SELECT COUNT(*) as count FROM squawk_alerts WHERE dismissed = 0"
      ).get() as { count: number };
      const activeOrbits = db.prepare(
        "SELECT COUNT(*) as count FROM orbit_detections WHERE active = 1"
      ).get() as { count: number };

      // Mask pushover keys in status response — just show configured/not
      const safeSettings = { ...settings };
      if (safeSettings.pushover_user_key) safeSettings.pushover_user_key = "***configured***";
      if (safeSettings.pushover_app_token) safeSettings.pushover_app_token = "***configured***";

      return Response.json({
        lastFetch: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
        error: fetchError,
        totalInRadius: currentAircraft.length,
        militaryCount: currentMilitary.length,
        activeAlerts: activeAlerts.count,
        activeSquawkAlerts: activeSquawkAlerts.count,
        activeOrbits: activeOrbits.count,
        pushoverConfigured: !!(settings.pushover_user_key && settings.pushover_app_token),
        pushoverEnabled: settings.pushover_enabled === "1",
        settings: safeSettings,
      }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/aircraft ───────────────────────────────────────────
    if (path === "/api/adsb/aircraft") {
      const rows = db.prepare(
        "SELECT *, CASE WHEN is_military = 1 THEN 1 ELSE 0 END as mil FROM aircraft_cache ORDER BY distance_nm ASC LIMIT 500"
      ).all();
      return Response.json({ aircraft: rows, lastFetch: lastFetchTime }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/military ───────────────────────────────────────────
    if (path === "/api/adsb/military") {
      const page = Number(url.searchParams.get("page")) || 1;
      const limit = Number(url.searchParams.get("limit")) || 50;
      const offset = (page - 1) * limit;

      const total = (db.prepare("SELECT COUNT(*) as count FROM military_contacts").get() as { count: number }).count;
      const contacts = db.prepare(
        "SELECT * FROM military_contacts ORDER BY first_seen DESC LIMIT ? OFFSET ?"
      ).all(limit, offset) as any[];

      const enriched = contacts.map(c => ({
        ...c,
        wiki_url: getWikiUrl(c.type_code, c.type_desc),
        track_url: getAdsbTrackUrl(c.hex),
      }));

      return Response.json({ contacts: enriched, total, page, limit }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/military/:id ───────────────────────────────────────
    if (path.startsWith("/api/adsb/military/") && req.method === "GET") {
      const segments = path.split("/");
      const id = segments[segments.length - 1];
      if (segments.length !== 5 || !id || !/^\d+$/.test(id)) return Response.json({ error: "Invalid ID" }, { status: 400, headers: getCorsHeaders(req) });
      const contact = db.prepare("SELECT * FROM military_contacts WHERE id = ?").get(id) as any;
      if (!contact) return Response.json({ error: "Not found" }, { status: 404, headers: getCorsHeaders(req) });

      contact.wiki_url = getWikiUrl(contact.type_code, contact.type_desc);
      contact.track_url = getAdsbTrackUrl(contact.hex);

      const otherSightings = db.prepare(
        "SELECT id, first_seen, last_seen, distance_nm, alt_baro, flight FROM military_contacts WHERE hex = ? AND id != ? ORDER BY first_seen DESC LIMIT 20"
      ).all(contact.hex, id);

      return Response.json({ contact, otherSightings }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/watchlist ──────────────────────────────────────────
    if (path === "/api/adsb/watchlist" && req.method === "GET") {
      const items = db.prepare(`
        SELECT w.*,
          (SELECT COUNT(*) FROM watchlist_alerts WHERE watchlist_id = w.id) as total_alerts,
          (SELECT detected_at FROM watchlist_alerts WHERE watchlist_id = w.id ORDER BY detected_at DESC LIMIT 1) as last_seen
        FROM watchlist w ORDER BY w.created_at DESC
      `).all();
      return Response.json({ watchlist: items }, { headers: getCorsHeaders(req) });
    }

    // ── POST /api/adsb/watchlist ─────────────────────────────────────────
    if (path === "/api/adsb/watchlist" && req.method === "POST") {
      try {
        const body = await req.json() as { match_type: string; match_value: string; label?: string; notes?: string };
        if (!body.match_type || !body.match_value) {
          return Response.json({ error: "match_type and match_value required" }, { status: 400, headers: getCorsHeaders(req) });
        }
        if (!['hex', 'type', 'callsign', 'registration'].includes(body.match_type)) {
          return Response.json({ error: "match_type must be hex, type, callsign, or registration" }, { status: 400, headers: getCorsHeaders(req) });
        }

        db.prepare(
          "INSERT INTO watchlist (match_type, match_value, label, notes) VALUES (?, ?, ?, ?)"
        ).run(body.match_type, body.match_value.trim(), body.label || null, body.notes || null);

        return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
      } catch (err: any) {
        if (err.message?.includes("UNIQUE")) {
          return Response.json({ error: "Already on watchlist" }, { status: 409, headers: getCorsHeaders(req) });
        }
        const status = err.message?.includes("JSON") ? 400 : 500;
        return Response.json({ error: err.message }, { status, headers: getCorsHeaders(req) });
      }
    }

    // ── DELETE /api/adsb/watchlist/:id ────────────────────────────────────
    if (path.startsWith("/api/adsb/watchlist/") && req.method === "DELETE") {
      const id = path.split("/").pop();
      if (!id || !/^\d+$/.test(id)) return Response.json({ error: "Invalid ID" }, { status: 400, headers: getCorsHeaders(req) });
      db.prepare("DELETE FROM watchlist WHERE id = ?").run(id);
      return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/alerts ─────────────────────────────────────────────
    if (path === "/api/adsb/alerts") {
      const dismissed = url.searchParams.get("dismissed") === "true" ? 1 : 0;
      const alerts = db.prepare(`
        SELECT a.*, w.match_type, w.match_value, w.label as watchlist_label
        FROM watchlist_alerts a
        JOIN watchlist w ON a.watchlist_id = w.id
        WHERE a.dismissed = ?
        ORDER BY a.detected_at DESC
        LIMIT 100
      `).all(dismissed);
      return Response.json({ alerts }, { headers: getCorsHeaders(req) });
    }

    // ── POST /api/adsb/alerts/dismiss ────────────────────────────────────
    if (path === "/api/adsb/alerts/dismiss" && req.method === "POST") {
      let body: { id?: number; all?: boolean };
      try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: getCorsHeaders(req) }); }
      if (body.all) {
        db.prepare("UPDATE watchlist_alerts SET dismissed = 1 WHERE dismissed = 0").run();
      } else if (body.id) {
        db.prepare("UPDATE watchlist_alerts SET dismissed = 1 WHERE id = ?").run(body.id);
      }
      return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/squawk-alerts ──────────────────────────────────────
    if (path === "/api/adsb/squawk-alerts") {
      const dismissed = url.searchParams.get("dismissed") === "true" ? 1 : 0;
      const alerts = db.prepare(`
        SELECT * FROM squawk_alerts
        WHERE dismissed = ?
        ORDER BY detected_at DESC
        LIMIT 100
      `).all(dismissed);
      return Response.json({ alerts }, { headers: getCorsHeaders(req) });
    }

    // ── POST /api/adsb/squawk-alerts/dismiss ─────────────────────────────
    if (path === "/api/adsb/squawk-alerts/dismiss" && req.method === "POST") {
      let body: { id?: number; all?: boolean };
      try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: getCorsHeaders(req) }); }
      if (body.all) {
        db.prepare("UPDATE squawk_alerts SET dismissed = 1 WHERE dismissed = 0").run();
      } else if (body.id) {
        db.prepare("UPDATE squawk_alerts SET dismissed = 1 WHERE id = ?").run(body.id);
      }
      return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
    }

    // ── POST /api/adsb/pushover/test ─────────────────────────────────────
    if (path === "/api/adsb/pushover/test" && req.method === "POST") {
      const settings = getSettings();
      const userKey = settings.pushover_user_key;
      const appToken = settings.pushover_app_token;

      if (!userKey || !appToken) {
        return Response.json({ error: "Pushover keys not configured. Enter them in Settings first." }, { status: 400, headers: getCorsHeaders(req) });
      }

      try {
        const res = await fetch("https://api.pushover.net/1/messages.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: appToken,
            user: userKey,
            title: "ADSB Tracker",
            message: "Test notification from your ADSB tracker. Squawk and watchlist alerts are live!",
            priority: 0,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          return Response.json({ error: `Pushover API error: ${text}` }, { status: 400, headers: getCorsHeaders(req) });
        }

        return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: getCorsHeaders(req) });
      }
    }

    // ── PUT /api/adsb/settings ───────────────────────────────────────────
    if (path === "/api/adsb/settings" && req.method === "PUT") {
      const body = await req.json() as Record<string, string>;
      const radiusKeys = ["all_radius_nm", "mil_radius_nm", "squawk_radius_nm", "watchlist_radius_nm"];
      const allowed = [
        ...radiusKeys, "refresh_interval_sec",
        "pushover_user_key", "pushover_app_token", "pushover_enabled",
      ];
      for (const [key, value] of Object.entries(body)) {
        if (!allowed.includes(key)) continue;
        if (key === "pushover_user_key" || key === "pushover_app_token") {
          if (value && !/^[a-zA-Z0-9]{20,50}$/.test(value)) continue;
        }
        let sanitized = String(value);
        if (radiusKeys.includes(key)) {
          sanitized = String(Math.max(1, Math.min(250, Number(value) || 5)));
        } else if (key === "refresh_interval_sec") {
          sanitized = String(Math.max(30, Math.min(300, Number(value) || 30)));
        }
        setSetting.run(key, sanitized);
      }
      return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
    }

    // ── POST /api/adsb/fetch ─────────────────────────────────────────────
    if (path === "/api/adsb/fetch" && req.method === "POST") {
      await fetchADSBData();
      return Response.json({ ok: true, lastFetch: lastFetchTime }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/stats ──────────────────────────────────────────────
    if (path === "/api/adsb/stats") {
      const totalMil = (db.prepare("SELECT COUNT(*) as c FROM military_contacts").get() as any).c;
      const uniqueTypes = (db.prepare("SELECT COUNT(DISTINCT type_code) as c FROM military_contacts WHERE type_code IS NOT NULL").get() as any).c;
      const uniqueHex = (db.prepare("SELECT COUNT(DISTINCT hex) as c FROM military_contacts").get() as any).c;
      const todayMil = (db.prepare("SELECT COUNT(*) as c FROM military_contacts WHERE first_seen > datetime('now', '-24 hours')").get() as any).c;
      const watchCount = (db.prepare("SELECT COUNT(*) as c FROM watchlist").get() as any).c;
      const totalSquawkAlerts = (db.prepare("SELECT COUNT(*) as c FROM squawk_alerts").get() as any).c;

      const topTypes = db.prepare(
        "SELECT type_code, type_desc, COUNT(*) as count FROM military_contacts WHERE type_code IS NOT NULL GROUP BY type_code ORDER BY count DESC LIMIT 10"
      ).all();

      const trackHistoryCount = (db.prepare("SELECT COUNT(*) as c FROM track_history").get() as any).c;
      const totalOrbits = (db.prepare("SELECT COUNT(*) as c FROM orbit_detections").get() as any).c;
      const activeOrbitCount = (db.prepare("SELECT COUNT(*) as c FROM orbit_detections WHERE active = 1").get() as any).c;

      return Response.json({ totalMil, uniqueTypes, uniqueHex, todayMil, watchCount, topTypes, totalSquawkAlerts, trackHistoryCount, totalOrbits, activeOrbitCount }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/track/:hex ─────────────────────────────────────────
    if (path.startsWith("/api/adsb/track/") && req.method === "GET") {
      const hex = path.split("/").pop();
      if (!hex || hex.length < 4) return Response.json({ error: "Invalid hex" }, { status: 400, headers: getCorsHeaders(req) });
      const hours = Number(url.searchParams.get("hours")) || 24;
      const maxHours = Math.min(hours, 720); // 30 days max
      const points = db.prepare(
        "SELECT lat, lon, alt_baro, alt_geom, ground_speed, track, distance_nm, is_military, timestamp FROM track_history WHERE hex = ? AND timestamp > datetime('now', '-' || ? || ' hours') ORDER BY timestamp ASC"
      ).all(hex.toLowerCase(), maxHours);
      return Response.json({ hex, points, count: points.length }, { headers: getCorsHeaders(req) });
    }

    // ── GET /api/adsb/orbits ──────────────────────────────────────────────
    if (path === "/api/adsb/orbits" && req.method === "GET") {
      const activeOnly = url.searchParams.get("active") === "true";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
      let query = "SELECT * FROM orbit_detections";
      if (activeOnly) query += " WHERE active = 1";
      query += " ORDER BY start_time DESC LIMIT ?";
      const orbits = db.prepare(query).all(limit) as any[];
      const enriched = orbits.map(o => ({
        ...o,
        wiki_url: getWikiUrl(o.type_code, o.type_desc),
        track_url: getAdsbTrackUrl(o.hex),
        duration_min: o.start_time && o.end_time
          ? Math.round((new Date(o.end_time + 'Z').getTime() - new Date(o.start_time + 'Z').getTime()) / 60000)
          : null,
      }));
      const activeCount = (db.prepare("SELECT COUNT(*) as c FROM orbit_detections WHERE active = 1").get() as any).c;
      return Response.json({ orbits: enriched, activeCount }, { headers: getCorsHeaders(req) });
    }

    // ── POST /api/adsb/watchlist/add-from-contact ────────────────────────
    // Uses hex match (most specific) — type match would be too broad (all aircraft of that type)
    if (path === "/api/adsb/watchlist/add-from-contact" && req.method === "POST") {
      try {
        const body = await req.json() as { hex: string; label?: string };
        const contact = db.prepare("SELECT * FROM military_contacts WHERE hex = ? ORDER BY first_seen DESC LIMIT 1").get(body.hex) as any;
        if (!contact) return Response.json({ error: "Contact not found" }, { status: 404, headers: getCorsHeaders(req) });

        const label = body.label || `${contact.type_desc || contact.type_code || 'Unknown'} (${contact.hex})`;
        db.prepare(
          "INSERT OR IGNORE INTO watchlist (match_type, match_value, label) VALUES ('hex', ?, ?)"
        ).run(contact.hex, label);

        return Response.json({ ok: true }, { headers: getCorsHeaders(req) });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: getCorsHeaders(req) });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: getCorsHeaders(req) });
  },
});

// ── Periodic Fetch ──────────────────────────────────────────────────────────

// Dynamic fetch loop — re-reads interval setting each cycle so changes take effect immediately
async function fetchLoop(): Promise<void> {
  await fetchADSBData();
  const settings = getSettings();
  const intervalSec = Math.max(30, Number(settings.refresh_interval_sec) || 30);
  setTimeout(fetchLoop, intervalSec * 1000);
}

fetchLoop();
console.log("Fetch loop started (dynamic interval)");

console.log(`ADSB Backend running on http://0.0.0.0:${PORT}`);
console.log(`Home: ${HOME_LAT}, ${HOME_LON}`);
console.log(`Database: ${DB_PATH}`);
