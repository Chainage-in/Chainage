// Chainage. Wikipedia corridor backbone
// Builds a dated background chronology for each corridor from Wikipedia.
// Run: node scripts/fetch-wikipedia.mjs   (writes data/history.json)
//
// This is REFERENCE material, not news. Wikipedia is a tertiary source: it is
// useful for establishing roughly when a corridor was built, widened or opened,
// and it usually cites something you can chase. It is not evidence on its own.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://en.wikipedia.org/w/api.php";
const UA = "Chainage/1.0 (corridor history tool; contact via repository)";
// Fetched in batches so a first run does not take an hour. Assets with no
// background yet are done first, so coverage fills in over a few runs and then
// only refreshes.
const BATCH = 400;
const REFRESH_DAYS = 120;
const PAUSE_MS = 180;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = API + "?" + new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Candidate article titles for a corridor code, best guess first.
function candidates(c) {
  const label = c.label;
  if (c.kind === "EXP") return [label, label + " (India)", label.replace(/ Expressway$/, "")+" Expressway"];
  if (c.kind === "NH") {
    const n = c.code.replace("NH-", "");
    return [`National Highway ${n} (India)`, `National Highway ${n}`, `NH ${n} (India)`];
  }
  if (c.kind === "SH") return [`State Highway ${c.code.replace("SH-", "")} (India)`];
  if (c.kind === "AH") {
    const n = c.code.replace("AH-", "");
    return [`AH${n}`, `Asian Highway ${n}`];
  }
  if (c.kind === "AIRPORT") {
    const bare = label.replace(/\s+(International\s+)?Airport$/i, "");
    return [label, bare + " Airport", bare + " International Airport", bare];
  }
  if (c.kind === "PORT") {
    const bare = label.replace(/\s+Port$/i, "");
    return [label, bare + " Port", "Port of " + bare, bare + " Port Trust", bare];
  }
  if (c.kind === "ZONE" || c.kind === "DFC" || c.kind === "RAIL") {
    return [label, label + " (India)", label.replace(/ rail line$/, "")+" railway line"];
  }
  return [label];
}

async function findPage(titles) {
  for (const t of titles) {
    try {
      const j = await api({ action: "query", prop: "extracts", explaintext: "1",
                            redirects: "1", titles: t });
      const pages = j?.query?.pages || {};
      for (const k of Object.keys(pages)) {
        const p = pages[k];
        if (p.missing !== undefined) continue;
        if (!p.extract || p.extract.length < 200) continue;
        // Guard against landing on a disambiguation or unrelated page.
        if (/may refer to:/i.test(p.extract.slice(0, 400))) continue;
        return { title: p.title, extract: p.extract };
      }
    } catch { /* try the next candidate */ }
    await sleep(PAUSE_MS);
  }
  return null;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

// Pull sentences that carry a year and say something about the corridor's state.
function datedSentences(text) {
  const EVENT = /\b(open|opened|inaugurat|complet|commission|widen|four-lan|six-lan|upgrad|sanction|award|approv|construct|declar|renumber|realign|toll|begun|began|start)/i;
  const out = [];
  const seen = new Set();

  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/);

  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length < 40 || s.length > 400) continue;
    if (!EVENT.test(s)) continue;

    const ym = s.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{4})\\b`));
    const y = s.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    if (!ym && !y) continue;

    const year = ym ? +ym[2] : +y[1];
    if (year < 1990 || year > new Date().getFullYear() + 12) continue;

    const month = ym ? new Date(`${ym[1]} 1, 2000`).getMonth() + 1 : null;
    const date = month ? `${year}-${String(month).padStart(2, "0")}` : String(year);

    const key = date + "|" + s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ date, year, text: s });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
}

async function main() {
  let corridors = [];
  try {
    const news = JSON.parse(await readFile(resolve(ROOT, "data", "news.json"), "utf8"));
    corridors = news.corridors || [];
  } catch {
    console.log("data/news.json not found, run scripts/fetch-feeds.mjs first.");
    process.exit(0);
  }
  if (!corridors.length) {
    console.log("No corridors on record yet. Run the feed collector first.");
    process.exit(0);
  }

  // Keep anything already fetched so repeat runs are cheap and additive.
  let prior = {};
  try {
    const h = JSON.parse(await readFile(resolve(ROOT, "data", "history.json"), "utf8"));
    prior = h.corridors || {};
    console.log(`Carrying forward background for ${Object.keys(prior).length} corridors.`);
  } catch { /* first run */ }

  const out = { ...prior };
  let fetched = 0, skipped = 0, missed = 0;

  // Never checked first, then whatever was checked longest ago. Assets with
  // news attached come before empty ones within each group.
  const due = corridors.filter((c) => {
    const e = out[c.code];
    if (!e || !e.checked) return true;
    return Date.now() - new Date(e.checked).getTime() >= REFRESH_DAYS * 864e5;
  }).sort((a, b) => {
    const ea = out[a.code], eb = out[b.code];
    if (!ea !== !eb) return ea ? 1 : -1;
    return (b.count || 0) - (a.count || 0);
  });

  skipped = corridors.length - due.length;
  const batch = due.slice(0, BATCH);
  console.log(`${corridors.length} assets on record, ${due.length} due, doing ${batch.length} this run.`);

  for (const c of batch) {
    const page = await findPage(candidates(c));
    if (!page) {
      out[c.code] = { checked: new Date().toISOString(), found: false, events: [] };
      missed++;
      console.log(`  --    ${c.code}, no Wikipedia article found`);
      continue;
    }
    const events = datedSentences(page.extract);
    out[c.code] = {
      checked: new Date().toISOString(),
      found: true,
      article: page.title,
      url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")),
      summary: page.extract.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 400),
      events,
    };
    fetched++;
    console.log(`  ok    ${c.code} - ${page.title} - ${events.length} dated lines`);
    await sleep(PAUSE_MS);
  }

  await mkdir(resolve(ROOT, "data"), { recursive: true });
  await writeFile(resolve(ROOT, "data", "history.json"),
    JSON.stringify({ updated: new Date().toISOString(), corridors: out }), "utf8");
  const withHistory = Object.values(out).filter((e) => e.found).length;
  console.log(`\nWrote data/history.json - ${fetched} fetched, ${skipped} already current, ${missed} not found.`);
  console.log(`${withHistory} of ${corridors.length} assets now have a published history.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
