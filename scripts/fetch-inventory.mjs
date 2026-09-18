// Chainage inventory builder.
// Populates the asset lists from published list pages so that every highway,
// airport and port is browsable, not only the ones that happened to appear in
// a headline this month. Run: node scripts/fetch-inventory.mjs
//
// Writes data/inventory.json. The feed collector merges this with what it has
// actually seen, so an asset with no coverage still shows, with a count of nil.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://en.wikipedia.org/w/api.php";
const UA = "Chainage/1.0 (asset inventory; contact via repository)";
const PAUSE = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wikitext(page) {
  const url = API + "?" + new URLSearchParams({
    action: "parse", page, prop: "wikitext", format: "json", formatversion: "2", origin: "*",
  });
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  const t = j?.parse?.wikitext;
  if (!t) throw new Error("no wikitext for " + page);
  return typeof t === "string" ? t : t["*"];
}

// Strip wiki markup down to plain text.
function clean(s) {
  return String(s || "")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/''+/g, "")
    .replace(/<ref[\s\S]*?(?:\/>|<\/ref>)/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull rows out of every wikitable on a page.
function tableRows(text) {
  const rows = [];
  for (const m of text.matchAll(/\{\|[^\n]*wikitable[\s\S]*?\n\|\}/g)) {
    const body = m[0];
    for (const chunk of body.split(/\n\|-+/)) {
      const cells = [];
      for (const line of chunk.split("\n")) {
        const m = line.match(/^\s*\|\s*(?!\})(.*)$/);
        if (!m) continue;
        for (const part of m[1].split("||")) {
          // Resolve links first, otherwise stripping the cell attribute eats the
          // pipe inside [[Target|Label]] and the label goes with it.
          const c = clean(part);
          cells.push(c.replace(/^\s*(?:align|style|colspan|rowspan|scope|class|width|bgcolor|valign)\s*=\s*[^|]*\|\s*/i, "").trim());
        }
      }
      if (cells.length >= 2) rows.push(cells);
    }
  }
  return rows;
}

const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

/* ------------------------------------------------------------------ */

async function highways() {
  const out = new Map();
  for (const page of ["List of national highways in India",
                      "List of national highways in India by state"]) {
    let text;
    try { text = await wikitext(page); }
    catch (e) { console.log(`  --    ${page}: ${e.message}`); continue; }

    for (const cells of tableRows(text)) {
      // The primary table writes "NH 44"; the by-number table lists the
      // three-digit subsidiaries as a bare "544D". Both are national highways.
      const m = String(cells[0]).match(/^(?:NH[\s-]?)?(\d{1,3}[A-Z]{0,3})$/i);
      if (!m) continue;
      // A bare number only counts when the row carries a route and a state,
      // otherwise any numeric column would be mistaken for a highway.
      if (!/^NH/i.test(cells[0]) && cells.length < 3) continue;
      const code = "NH-" + m[1].toUpperCase();
      if (out.has(code)) continue;
      const rest = cells.slice(1).join(" ");
      const km = rest.match(/\b([\d,]+(?:\.\d+)?)\s*km\b/i);
      out.set(code, {
        code, kind: "NH", label: code,
        lengthKm: km ? parseFloat(km[1].replace(/,/g, "")) : undefined,
        note: clean(cells.slice(1, 3).join(" to ")).slice(0, 120) || undefined,
      });
    }
    await sleep(PAUSE);
  }
  console.log(`  ok    national highways: ${out.size}`);
  return [...out.values()];
}

async function airports() {
  const out = new Map();
  let text;
  try { text = await wikitext("List of airports in India"); }
  catch (e) { console.log(`  --    airports: ${e.message}`); return []; }

  for (const cells of tableRows(text)) {
    // Rows look like: city, airport name, IATA, ICAO, role/usage
    const named = cells.find((c) => /airport|aerodrome|airfield/i.test(c) && c.length < 70);
    if (!named) continue;
    const label = titleCase(named.replace(/\s+/g, " ").trim());
    if (label.length < 6) continue;
    const code = "AIR:" + label.replace(/\s+/g, "-");
    if (out.has(code)) continue;
    const iata = cells.find((c) => /^[A-Z]{3}$/.test(c.trim()));
    out.set(code, { code, kind: "AIRPORT", label, iata: iata || undefined,
                    note: cells[0] && cells[0] !== named ? cells[0].slice(0, 60) : undefined });
  }
  console.log(`  ok    airports: ${out.size}`);
  return [...out.values()];
}

async function ports() {
  const out = new Map();
  for (const page of ["List of ports in India", "Major ports of India"]) {
    let text;
    try { text = await wikitext(page); }
    catch (e) { console.log(`  --    ${page}: ${e.message}`); continue; }

    for (const cells of tableRows(text)) {
      const named = cells.find((c) => /\bport\b|\bharbour\b|\bterminal\b/i.test(c) && c.length < 60);
      if (!named) continue;
      let label = titleCase(named.replace(/\s+/g, " ").trim());
      if (!/port|harbour|terminal/i.test(label)) label += " Port";
      if (label.length < 6) continue;
      const code = "SEA:" + label.replace(/\s+/g, "-");
      if (out.has(code)) continue;
      out.set(code, { code, kind: "PORT", label,
                      note: cells[0] && cells[0] !== named ? cells[0].slice(0, 60) : undefined });
    }
    await sleep(PAUSE);
  }
  console.log(`  ok    ports: ${out.size}`);
  return [...out.values()];
}

// The zones and freight corridors are a short fixed list, so no fetch needed.
function railAssets() {
  const zones = ["Central Railway","East Central Railway","East Coast Railway","Eastern Railway",
    "North Central Railway","North Eastern Railway","North Western Railway","Northeast Frontier Railway",
    "Northern Railway","South Central Railway","South East Central Railway","South Eastern Railway",
    "South Western Railway","Southern Railway","West Central Railway","Western Railway",
    "Konkan Railway","Kolkata Metro Railway","South Coast Railway"];
  const dfc = ["Eastern Dedicated Freight Corridor","Western Dedicated Freight Corridor",
    "East Coast Dedicated Freight Corridor","East West Dedicated Freight Corridor",
    "North South Dedicated Freight Corridor"];
  const out = zones.map((z) => ({ code: "ZONE:" + z.replace(/\s+/g, "-"), kind: "ZONE", label: z }))
    .concat(dfc.map((d) => ({ code: "DFC:" + d.replace(/\s+/g, "-"), kind: "DFC", label: d })));
  console.log(`  ok    rail zones and freight corridors: ${out.length}`);
  return out;
}

/* ------------------------------------------------------------------ */

async function main() {
  const assets = []
    .concat(await highways())
    .concat(railAssets())
    .concat(await airports())
    .concat(await ports());

  await mkdir(resolve(ROOT, "data"), { recursive: true });
  await writeFile(resolve(ROOT, "data", "inventory.json"),
    JSON.stringify({ updated: new Date().toISOString(), count: assets.length, assets }), "utf8");
  console.log(`\nWrote data/inventory.json - ${assets.length} assets.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
