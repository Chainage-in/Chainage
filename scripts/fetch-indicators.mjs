// Chainage indicator collector.
// Builds data/indicators.json from two kinds of input:
//   1. Sources that can be read automatically (IHMCL national ETC series).
//   2. Anything you put in data-drop/ as CSV, in the long format described
//      in data-drop/README.md. That is how WPI, GSDP, vehicle registrations
//      and plaza level series get in, because none of those publish a feed
//      that can be read without a login or a fragile scraper.
//
// Run: node scripts/fetch-indicators.mjs

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (compatible; Chainage/1.0)";
const TIMEOUT_MS = 30000;

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ").trim();

const num = (s) => {
  const c = String(s || "").replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  const v = parseFloat(c);
  return isNaN(v) ? null : v;
};

// Financial year label to the ISO date of its start (FY-24-25 -> 2024-04-01)
function fyToDate(label) {
  const m = String(label).match(/(\d{2})\s*-\s*(\d{2})/);
  if (!m) return null;
  return `20${m[1]}-04-01`;
}

/* ------------------------------------------------------------------ */
/* 1. IHMCL national ETC series                                        */
/* ------------------------------------------------------------------ */

const IHMCL_URL = "https://ihmcl.co.in/etc-transaction-reports/";

async function ihmcl() {
  const series = [];
  const reports = [];
  const html = await fetchText(IHMCL_URL);

  // The financial-year summary sits in a plain HTML table on the page.
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 3) continue;
    if (!/^FY[\s-]*\d{2}/i.test(cells[0])) continue;

    const date = fyToDate(cells[0]);
    if (!date) continue;
    const partial = /\(/.test(cells[0]);      // e.g. "FY-26-27 (Aug 26)"

    const vol = num(cells[1]);
    const val = num(cells[2]);
    if (vol !== null) series.push({ series: "etc_transactions_national", date,
      value: vol, unit: "lakh transactions", period: "FY", label: cells[0], partial,
      source: "IHMCL", sourceUrl: IHMCL_URL });
    if (val !== null) series.push({ series: "etc_collection_national", date,
      value: val, unit: "Rs crore", period: "FY", label: cells[0], partial,
      source: "IHMCL", sourceUrl: IHMCL_URL });
  }

  // Catalogue the monthly plaza-level PDFs so they are one click away.
  const seen = new Set();
  for (const [, href, text] of html.matchAll(/<a[^>]*href="([^"]+\.(?:pdf|zip))"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/ihmcl\.co\.in/i.test(href)) continue;
    const label = stripTags(text);
    if (!label || seen.has(href)) continue;
    const file = basename(href);
    // Skip corporate filings and guidance documents; we only want data reports.
    if (/annual[-_ ]?return|director|workstream|scheme|policy|circular|faq|sop|presentation|parking/i.test(file)) continue;

    const ym = file.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-_ ]?(\d{4})/i);
    const isZip = /\.zip$/i.test(file);
    const yOnly = (file.match(/\b(20\d{2})\b/) || label.match(/\b(20\d{2})\b/) || [])[1];

    const kind = /annual[-_ ]?pass/i.test(file) ? "Annual pass"
               : /mlff/i.test(file) ? "MLFF plazas"
               : (ym || /vc[-_ ]?wise/i.test(file) || (isZip && yOnly)) ? "Plaza and vehicle class"
               : null;
    if (!kind) continue;
    seen.add(href);
    reports.push({ label, kind, url: href,
      year: ym ? +ym[2] : (yOnly ? +yOnly : null),
      month: ym ? ym[1] : null,
      format: extname(file).replace(".", "").toUpperCase() });
  }
  const MONTH_ORDER = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const mOrd = (r) => MONTH_ORDER[String(r.month || "").slice(0, 3)] || 0;
  reports.sort((a, b) => (b.year || 0) - (a.year || 0) || mOrd(b) - mOrd(a) || String(a.kind).localeCompare(String(b.kind)));

  return { series, reports };
}

/* ------------------------------------------------------------------ */
/* 2. CSVs dropped into data-drop/                                     */
/* ------------------------------------------------------------------ */

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const t = text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

// Accepts YYYY, YYYY-MM, YYYY-MM-DD, FY-24-25, Apr-2024, Q1 2024
function normaliseDate(raw) {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return s + "-01";
  if (/^\d{4}$/.test(s)) return s + "-01-01";
  if (/^FY/i.test(s)) return fyToDate(s);
  const MON = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
                jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
  let m = s.match(/^([A-Za-z]{3})[a-z]*[-\s]*(\d{4})$/);
  if (m && MON[m[1].toLowerCase()]) return `${m[2]}-${MON[m[1].toLowerCase()]}-01`;
  m = s.match(/^(\d{4})[-\s]*([A-Za-z]{3})/);
  if (m && MON[m[2].toLowerCase()]) return `${m[1]}-${MON[m[2].toLowerCase()]}-01`;
  m = s.match(/^Q([1-4])[-\s]*(\d{4})$/i);
  if (m) return `${m[2]}-${["01","04","07","10"][+m[1] - 1]}-01`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function drops() {
  const dir = resolve(ROOT, "data-drop");
  let files = [];
  try { files = (await readdir(dir)).filter((f) => /\.csv$/i.test(f)); }
  catch { return { series: [], files: [] }; }

  const out = [];
  const log = [];
  for (const f of files) {
    try {
      const rows = parseCsv(await readFile(resolve(dir, f), "utf8"));
      if (rows.length < 2) { log.push({ file: f, rows: 0, note: "no data rows" }); continue; }
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (n) => head.indexOf(n);
      const iS = col("series"), iD = col("date"), iV = col("value");
      if (iS < 0 || iD < 0 || iV < 0) {
        log.push({ file: f, rows: 0, note: "needs series, date and value columns" });
        continue;
      }
      const idx = { unit: col("unit"), region: col("region"), corridor: col("corridor"),
                    plaza: col("plaza"), source: col("source"), url: col("sourceurl"),
                    category: col("category") };
      let kept = 0;
      for (const r of rows.slice(1)) {
        const date = normaliseDate(r[iD]);
        const value = num(r[iV]);
        const name = String(r[iS] || "").trim();
        if (!date || value === null || !name) continue;
        const rec = { series: name, date, value,
          unit: idx.unit >= 0 ? String(r[idx.unit] || "").trim() : "",
          source: idx.source >= 0 ? String(r[idx.source] || "").trim() : f,
          origin: "drop", file: f };
        for (const k of ["region", "corridor", "plaza", "category"]) {
          if (idx[k] >= 0 && r[idx[k]]) rec[k] = String(r[idx[k]]).trim();
        }
        if (idx.url >= 0 && r[idx.url]) rec.sourceUrl = String(r[idx.url]).trim();
        out.push(rec);
        kept++;
      }
      log.push({ file: f, rows: kept });
      console.log(`  drop  ${f} - ${kept} rows`);
    } catch (e) {
      log.push({ file: f, rows: 0, note: String(e.message || e) });
      console.log(`  FAIL  ${f} - ${e.message || e}`);
    }
  }
  return { series: out, files: log };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const sources = [];
  let series = [];
  let reports = [];

  try {
    const r = await ihmcl();
    series = series.concat(r.series);
    reports = r.reports;
    sources.push({ name: "IHMCL national ETC series", status: "ok",
                   rows: r.series.length, reports: r.reports.length });
    console.log(`  ok    IHMCL - ${r.series.length} rows, ${r.reports.length} monthly reports catalogued`);
  } catch (e) {
    sources.push({ name: "IHMCL national ETC series", status: "failed", error: String(e.message || e) });
    console.log(`  FAIL  IHMCL - ${e.message || e}`);
  }

  const d = await drops();
  series = series.concat(d.series);
  sources.push({ name: "data-drop CSV files", status: "ok",
                 rows: d.series.length, files: d.files.length });

  // Index the distinct series so the dashboard can list them without scanning.
  const meta = new Map();
  for (const r of series) {
    let m = meta.get(r.series);
    if (!m) {
      m = { id: r.series, unit: r.unit || "", source: r.source || "", n: 0,
            first: r.date, last: r.date, origin: r.origin || "auto",
            regions: new Set(), corridors: new Set(), plazas: new Set(),
            category: r.category || "" };
      meta.set(r.series, m);
    }
    m.n++;
    if (r.date < m.first) m.first = r.date;
    if (r.date > m.last) m.last = r.date;
    if (r.region) m.regions.add(r.region);
    if (r.corridor) m.corridors.add(r.corridor);
    if (r.plaza) m.plazas.add(r.plaza);
  }
  const catalogue = [...meta.values()].map((m) => ({
    ...m,
    regions: [...m.regions].sort(), corridors: [...m.corridors].sort(), plazas: [...m.plazas].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id));

  series.sort((a, b) => a.series.localeCompare(b.series) || a.date.localeCompare(b.date));

  await mkdir(resolve(ROOT, "data"), { recursive: true });
  await writeFile(resolve(ROOT, "data", "indicators.json"),
    JSON.stringify({ updated: new Date().toISOString(), sources, catalogue, reports, series }), "utf8");
  console.log(`\nWrote data/indicators.json - ${series.length} points across ${catalogue.length} series.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
