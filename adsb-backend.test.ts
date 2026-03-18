/**
 * ADSB Backend — Minimal Tests
 *
 * Since the backend is a single monolithic file that starts a server on import,
 * these tests validate the running server's endpoints via HTTP.
 *
 * Prerequisites: backend must be running on ADSB_PORT (default 8081).
 *
 * Run: bun test adsb-backend.test.ts
 */

import { describe, it, expect } from "bun:test";

const BASE = process.env.ADSB_TEST_URL || "http://localhost:8081";

describe("ADSB Backend API", () => {
  it("GET /api/adsb/healthz returns ok", async () => {
    const res = await fetch(`${BASE}/api/adsb/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe("ok");
    expect(typeof data.uptime).toBe("number");
    expect(data.dbPath).toBeTruthy();
  });

  it("GET /api/adsb/status returns status shape", async () => {
    const res = await fetch(`${BASE}/api/adsb/status`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("totalInRadius");
    expect(data).toHaveProperty("militaryCount");
    expect(data).toHaveProperty("settings");
  });

  it("GET /api/adsb/aircraft returns aircraft array", async () => {
    const res = await fetch(`${BASE}/api/adsb/aircraft`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data.aircraft)).toBe(true);
  });

  it("GET /api/adsb/military returns paginated contacts", async () => {
    const res = await fetch(`${BASE}/api/adsb/military?page=1&limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("contacts");
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("page");
    expect(data.page).toBe(1);
  });

  it("GET /api/adsb/military/:id rejects invalid ID", async () => {
    const res = await fetch(`${BASE}/api/adsb/military/abc`);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBe("Invalid ID");
  });

  it("GET /api/adsb/watchlist returns watchlist", async () => {
    const res = await fetch(`${BASE}/api/adsb/watchlist`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("watchlist");
  });

  it("POST /api/adsb/watchlist validates input", async () => {
    const res = await fetch(`${BASE}/api/adsb/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match_type: "invalid", match_value: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /api/adsb/watchlist/:id rejects invalid ID", async () => {
    const res = await fetch(`${BASE}/api/adsb/watchlist/abc`, {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBe("Invalid ID");
  });

  it("POST /api/adsb/alerts/dismiss rejects invalid JSON", async () => {
    const res = await fetch(`${BASE}/api/adsb/alerts/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/adsb/stats returns stats shape", async () => {
    const res = await fetch(`${BASE}/api/adsb/stats`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("totalMil");
    expect(data).toHaveProperty("uniqueHex");
    expect(data).toHaveProperty("topTypes");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${BASE}/api/adsb/nonexistent`);
    expect(res.status).toBe(404);
  });
});
