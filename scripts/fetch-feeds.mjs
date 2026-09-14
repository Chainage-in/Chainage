// Chainage. India transport corridor monitor
// Feed collector. Zero dependencies. Run: node scripts/fetch-feeds.mjs
// Reads feeds.json, writes data/news.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RETAIN_DAYS = 400;      // keep a long archive so corridor timelines build up
const MAX_ITEMS = 4000;
const TIMEOUT_MS = 25000;
const THIS_YEAR = new Date().getFullYear();

/* ================================================================== */
/* XML parsing                                                         */
/* ================================================================== */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "\u201C", rdquo: "\u201D", lsquo: "\u2018", rsquo: "\u2019",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", rsaquo: "\u203A",
};

function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function stripTags(s) {
  let t = decodeEntities(String(s || ""));
  t = t.replace(/<[^>]*>/g, " ");
  t = decodeEntities(t).replace(/<[^>]*>/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

function unwrapCdata(s) {
  const m = String(s || "").match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : s;
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? stripTags(unwrapCdata(m[1])) : "";
}

function atomLink(block) {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return any ? decodeEntities(any[1]) : "";
}

function parseFeed(xml) {
  const out = [];
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  for (const [, block] of blocks) {
    const title = tagText(block, "title");
    if (!title) continue;
    let link = tagText(block, "link");
    if (!link || !/^https?:/i.test(link)) link = atomLink(block);
    const src = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    out.push({
      title,
      link: (link || "").trim(),
      published: tagText(block, "pubDate") || tagText(block, "published") ||
                 tagText(block, "updated") || tagText(block, "dc:date"),
      summary: tagText(block, "description") || tagText(block, "summary") || tagText(block, "content"),
      feedSource: src ? stripTags(unwrapCdata(src[1])) : "",
    });
  }
  return out;
}

/* ================================================================== */
/* Corridor extraction                                                 */
/* ================================================================== */

// Named expressways worth recognising even when no number is given.
const NAMED_EXPRESSWAYS = [
  "Delhi-Mumbai Expressway", "Delhi Mumbai Expressway",
  "Purvanchal Expressway", "Bundelkhand Expressway", "Ganga Expressway",
  "Agra-Lucknow Expressway", "Lucknow-Kanpur Expressway", "Gorakhpur Link Expressway",
  "Yamuna Expressway", "Noida-Greater Noida Expressway",
  "Eastern Peripheral Expressway", "Western Peripheral Expressway", "Kundli-Manesar-Palwal",
  "Delhi-Meerut Expressway", "Dwarka Expressway", "Urban Extension Road",
  "Delhi-Amritsar-Katra Expressway", "Delhi-Dehradun Expressway",
  "Samruddhi Mahamarg", "Mumbai-Nagpur Expressway", "Mumbai-Pune Expressway",
  "Bengaluru-Mysuru Expressway", "Chennai-Bengaluru Expressway",
  "Ahmedabad-Dholera Expressway", "Ahmedabad-Vadodara Expressway",
  "Surat-Chennai Expressway", "Raipur-Visakhapatnam Expressway",
  "Hyderabad-Visakhapatnam", "Nagpur-Vijayawada", "Kharagpur-Siliguri",
  "Varanasi-Kolkata Expressway", "Patna-Purnea Expressway", "Gorakhpur-Siliguri Expressway",
  "Amritsar-Jamnagar Expressway", "Ambala-Kotputli", "Pune Ring Road",
  "Mumbai Trans Harbour Link", "Atal Setu", "Chenab Bridge",
  "Eastern Dedicated Freight Corridor", "Western Dedicated Freight Corridor",
];

function canonCode(kind, num) {
  return `${kind.toUpperCase()}-${String(num).toUpperCase()}`;
}

function extractCorridors(text) {
  const found = new Map(); // code -> {code, kind, label}

  // NH / SH / MDR / AH numbers: "NH-27", "NH 27", "NH27", "AH-45", "SH 9A"
  const reNum = /\b(NH|SH|AH|MDR)\s*[---]?\s*(\d{1,3}[A-Z]{0,2})\b/gi;
  let m;
  while ((m = reNum.exec(text)) !== null) {
    const kind = m[1].toUpperCase();
    const code = canonCode(kind, m[2]);
    found.set(code, { code, kind, label: code });
  }

  // "National Highway 27" / "State Highway 9" spelled out
  const reWord = /\b(National Highway|State Highway|Asian Highway)\s*(?:No\.?\s*)?(\d{1,3}[A-Z]{0,2})\b/gi;
  while ((m = reWord.exec(text)) !== null) {
    const kind = m[1].toLowerCase().startsWith("national") ? "NH"
               : m[1].toLowerCase().startsWith("asian") ? "AH" : "SH";
    const code = canonCode(kind, m[2]);
    found.set(code, { code, kind, label: code });
  }

  // Named expressways from the list
  const lower = text.toLowerCase();
  for (const name of NAMED_EXPRESSWAYS) {
    if (lower.includes(name.toLowerCase())) {
      const code = "EXP:" + name.replace(/\s+/g, "-");
      found.set(code, { code, kind: "EXP", label: name });
    }
  }

  // Any other "<Something> Expressway" phrase
  const reExp = /\b([A-Z][A-Za-z]+(?:[--][A-Z][A-Za-z]+)*(?:\s[A-Z][A-Za-z]+)?)\s+Expressway\b/g;
  while ((m = reExp.exec(text)) !== null) {
    const name = `${m[1]} Expressway`;
    const code = "EXP:" + name.replace(/\s+/g, "-");
    if (!found.has(code)) found.set(code, { code, kind: "EXP", label: name });
  }

  return [...found.values()].slice(0, 8);
}

/* ================================================================== */
/* Classification                                                      */
/* ================================================================== */

const MODES = [
  { id: "road", label: "Road", terms: ["highway","nhai","morth","expressway","toll","fastag","national highway","bypass","flyover","road transport","trucking","truckers","bot toll","ham project","carriageway","lane","ring road","four-laning","six-laning"] },
  { id: "rail", label: "Rail", terms: ["railway","railways","rail","train","dfccil","freight corridor","vande bharat","metro","locomotive","wagon","rrts","gauge","doubling","electrification"] },
  { id: "air",  label: "Air",  terms: ["airport","airline","aviation","dgca","flight","air passenger","terminal building","airports authority","udan","runway"] },
  { id: "port", label: "Ports & shipping", terms: ["port","shipping","cargo","container","maritime","vessel","jnpt","sagarmala","waterway","shipyard","tonnage","teu","berth"] },
];

const CATEGORIES = [
  { id: "project",    label: "New project / award",  terms: ["approved","sanctioned","awarded","bid","tender","foundation stone","commissioned","inaugurat","greenfield","construction","contract","letter of award","concession","financial close","groundbreak","four-laning","six-laning","widening"] },
  { id: "tariff",     label: "Tariff & tolling",     terms: ["toll rate","toll hike","fee revision","user fee","tariff","fastag","annual pass","toll collection","monetisation","monetization","tot bundle","invit","toll plaza"] },
  { id: "disruption", label: "Disruption / closure", terms: ["closed","closure","diversion","blocked","landslide","flood","washed away","collapse","strike","bandh","protest","accident","suspended","restriction","ban","agitation","curfew"] },
  { id: "policy",     label: "Policy & regulation",  terms: ["policy","rules","notification","guidelines","cabinet","amendment","regulator","gst","budget","scheme","gati shakti","norms","circular","arbitration"] },
  { id: "global",     label: "Global / macro",       terms: ["trade war","global","crude","oil price","export","import","red sea","suez","sanction","gdp","inflation","recession","tariff","freight rate","exchange rate"] },
  { id: "traffic",    label: "Traffic & volumes",    terms: ["traffic","footfall","passenger","volumes","throughput","loading","aadt","tonnes","million tonnes","e-way bill","pcu","vehicle count"] },
  { id: "industry",   label: "Industry & catchment", terms: ["plant","factory","refinery","cement","steel","mine","mining","coal","iron ore","sez","industrial park","logistics park","warehouse","icd","plant commissioned","investment"] },
];

// Signal: what the event does to the transport system. Deliberately NOT a
// direction call, the same event helps one asset and hurts another, so the
// analyst decides direction for their own corridor.
const SIGNALS = [
  { id: "capacity_add",  label: "Capacity added",   terms: ["opened to traffic","inaugurated","commissioned","thrown open","new lane","four-laning complete","six-laning complete","bypass opened","bridge opened","new terminal","new line","doubling complete","widened","expanded capacity"] },
  { id: "capacity_loss", label: "Capacity lost",    terms: ["closed","closure","collapse","washed away","landslide","damaged","suspended","blocked","restriction","one-way","bridge shut","route diverted"] },
  { id: "demand_add",    label: "Demand added",     terms: ["plant commissioned","new plant","production begins","mine allotted","output rises","cargo rises","throughput rises","freight loading rises","new industrial","investment announced","tourist","pilgrim"] },
  { id: "demand_loss",   label: "Demand lost",      terms: ["mining ban","production halted","plant shut","output falls","cargo falls","volumes fall","demand slump","shutdown","lockout","export ban"] },
  { id: "price",         label: "Price change",     terms: ["toll hike","fee revision","user fee","tariff revised","rate increase","diesel price","fuel price","freight rate","pass price","exemption"] },
  { id: "rule",          label: "Rule change",      terms: ["notification","rules amended","policy","guidelines","cabinet approves","circular","mandate","norms","court order","directed"] },
];

// Claim maturity, how far along the thing actually is. Ordered most to least advanced.
const MATURITY = [
  { id: "open",         label: "Open to traffic", terms: ["opened to traffic","thrown open","inaugurated","commissioned","now operational","tolling begins","toll collection started","dedicated to the nation","fully operational"] },
  { id: "construction", label: "Under construction", terms: ["under construction","work has begun","construction started","work in progress","per cent complete","% complete","nearing completion","construction underway","appointed date"] },
  { id: "awarded",      label: "Awarded",         terms: ["awarded","letter of award","contract signed","bagged the contract","wins contract","concession agreement signed","financial closure","emerges lowest bidder","l1 bidder"] },
  { id: "sanctioned",   label: "Sanctioned",      terms: ["approved","sanctioned","cabinet nod","ccea","gets nod","cleared by","green light","allocation approved"] },
  { id: "proposed",     label: "Proposed",        terms: ["proposed","plans to","to be built","feasibility","dpr","detailed project report","mulls","likely to be","may build","under consideration","survey ordered"] },
];

const STATES = ["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu","Kashmir","Ladakh","Puducherry","Chandigarh","Andaman"];

const TRANSPORT_GATE = ["highway","road","toll","nhai","morth","expressway","railway","rail","train","airport","aviation","airline","port","shipping","cargo","logistics","freight","transport","metro","bridge","corridor","waterway","vehicle","traffic","fastag","gati shakti"];

const lc = (s) => String(s || "").toLowerCase();
const hits = (text, terms) => terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);

function firstMatch(text, table) {
  for (const row of table) if (hits(text, row.terms) > 0) return row.id;
  return null;
}

// Pick the row with the most keyword hits; ties fall to table order.
function bestMatch(text, table) {
  let best = null, score = 0;
  for (const row of table) {
    const s = hits(text, row.terms);
    if (s > score) { score = s; best = row.id; }
  }
  return best;
}

function classify(title, summary) {
  const raw = `${title} ${summary}`;
  const text = lc(raw);

  let mode = "other", best = 0;
  for (const m of MODES) { const s = hits(text, m.terms); if (s > best) { best = s; mode = m.id; } }

  const categories = CATEGORIES.filter((c) => hits(text, c.terms) > 0).map((c) => c.id);
  if (!categories.length) categories.push("policy");

  const signal = bestMatch(text, SIGNALS) || "info";
  const maturity = firstMatch(text, MATURITY) || "reported";

  // Forward-looking if a future year or future-tense phrase appears, or if the
  // thing simply is not built yet, anything short of "open" is still to come.
  const years = [...raw.matchAll(/\b(20\d{2})\b/g)].map((m) => +m[1]).filter((y) => y > THIS_YEAR);
  const futurePhrase = /\b(will (be )?(open|complete|start|commission)|expected (to|by)|targeted for|by (early |mid |late )?20\d{2}|deadline|scheduled for|slated (to|for)|set to open)\b/i.test(raw);
  const notBuiltYet = ["proposed", "sanctioned", "awarded", "construction"].includes(maturity);
  const horizon = years.length || futurePhrase || notBuiltYet ? "forward" : "past";

  const corridors = extractCorridors(raw);
  // A state-highway or expressway reference is itself proof this is road news,
  // even when no road keyword appears in the headline.
  if (mode === "other" && corridors.some((c) => ["NH", "SH", "AH", "MDR", "EXP"].includes(c.kind))) {
    mode = "road";
  }

  return {
    mode,
    categories,
    signal,
    maturity,
    horizon,
    targetYear: years.length ? Math.min(...years) : null,
    regions: STATES.filter((s) => text.includes(lc(s))).slice(0, 5),
    corridors,
  };
}

const isTransportRelevant = (i) =>
  TRANSPORT_GATE.some((t) => lc(`${i.title} ${i.summary}`).includes(t));

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function splitGoogleTitle(title) {
  const m = title.match(/^(.*)\s+-\s+([^-]{2,60})$/);
  return m ? { headline: m[1].trim(), publisher: m[2].trim() } : { headline: title, publisher: "" };
}

const normaliseKey = (t) =>
  lc(t).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);

function toISO(d) {
  const x = new Date(d);
  return isNaN(x.getTime()) ? null : x.toISOString();
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Chainage/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

/* ================================================================== */
/* Main                                                                */
/* ================================================================== */

async function main() {
  const cfg = JSON.parse(await readFile(resolve(ROOT, "feeds.json"), "utf8"));
  const template = cfg.googleNewsTemplate;

  // Carry forward the existing archive so corridor history accumulates
  // instead of resetting to whatever the feeds happen to show today.
  let archive = [];
  try {
    const prev = JSON.parse(await readFile(resolve(ROOT, "data", "news.json"), "utf8"));
    archive = Array.isArray(prev.items) ? prev.items : [];
    console.log(`Carrying forward ${archive.length} archived items.`);
  } catch { console.log("No existing archive; starting fresh."); }

  const targets = cfg.feeds.map((f) => ({
    ...f,
    url: f.url || template.replace("{QUERY}", encodeURIComponent(f.query)),
  }));

  const fresh = [];
  const sourceLog = [];

  for (const t of targets) {
    try {
      const items = parseFeed(await fetchText(t.url));
      let kept = 0;
      for (const raw of items) {
        if (t.gate && !isTransportRelevant(raw)) continue;
        const { headline, publisher } = t.official
          ? { headline: raw.title, publisher: t.publisher }
          : splitGoogleTitle(raw.title);
        const iso = toISO(raw.published);
        if (!iso || !raw.link) continue;
        fresh.push({
          title: headline,
          url: raw.link,
          publisher: raw.feedSource || publisher || t.publisher || t.name,
          official: !!t.official,
          published: iso,
          summary: raw.summary && raw.summary !== raw.title ? raw.summary.slice(0, 320) : "",
          ...classify(headline, raw.summary),
        });
        kept++;
      }
      sourceLog.push({ name: t.name, status: "ok", items: kept });
      console.log(`  ok    ${t.name} - ${kept}`);
    } catch (err) {
      sourceLog.push({ name: t.name, status: "failed", error: String(err.message || err) });
      console.log(`  FAIL  ${t.name} - ${err.message || err}`);
    }
  }

  // Merge archive + fresh, dedupe by normalised headline, count corroboration.
  const byKey = new Map();
  for (const item of [...archive, ...fresh]) {
    const key = normaliseKey(item.title);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...item, corroboration: item.corroboration || 1, publishers: item.publishers || [item.publisher] });
    } else {
      const pubs = new Set([...(prev.publishers || []), item.publisher].filter(Boolean));
      const winner = item.official && !prev.official ? { ...item } : prev;
      byKey.set(key, { ...winner, corroboration: pubs.size, publishers: [...pubs].slice(0, 8) });
    }
  }

  const cutoff = Date.now() - RETAIN_DAYS * 864e5;
  const items = [...byKey.values()]
    .filter((i) => new Date(i.published).getTime() >= cutoff)
    .sort((a, b) => new Date(b.published) - new Date(a.published))
    .slice(0, MAX_ITEMS)
    .map((i, idx) => ({ ...i, id: "c" + idx + "-" + normaliseKey(i.title).slice(0, 20).replace(/ /g, "_") }));

  // Corridor index, one entry per corridor seen, for the picker.
  const corridorMap = new Map();
  for (const it of items) {
    for (const c of it.corridors || []) {
      let e = corridorMap.get(c.code);
      if (!e) {
        e = { code: c.code, kind: c.kind, label: c.label, count: 0, states: {}, first: it.published, last: it.published };
        corridorMap.set(c.code, e);
      }
      e.count++;
      (it.regions || []).forEach((r) => { e.states[r] = (e.states[r] || 0) + 1; });
      if (it.published < e.first) e.first = it.published;
      if (it.published > e.last) e.last = it.published;
    }
  }
  const corridors = [...corridorMap.values()]
    .map((e) => ({ ...e, states: Object.keys(e.states).sort((a, b) => e.states[b] - e.states[a]).slice(0, 6) }))
    .sort((a, b) => b.count - a.count);

  // Curated macro / environmental / social / geopolitical timeline.
  let macro = [];
  try {
    const m = JSON.parse(await readFile(resolve(ROOT, "history", "macro-events.json"), "utf8"));
    macro = Array.isArray(m.events) ? m.events : [];
    console.log(`Loaded ${macro.length} curated macro events.`);
  } catch { console.log("No history/macro-events.json, skipping macro timeline."); }

  const payload = {
    updated: new Date().toISOString(),
    macro,
    count: items.length,
    sources: sourceLog,
    modes: MODES.map(({ id, label }) => ({ id, label })),
    categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
    signals: SIGNALS.map(({ id, label }) => ({ id, label })).concat([{ id: "info", label: "Information" }]),
    maturities: MATURITY.map(({ id, label }) => ({ id, label })).concat([{ id: "reported", label: "Reported" }]),
    corridors,
    items,
  };

  await mkdir(resolve(ROOT, "data"), { recursive: true });
  await writeFile(resolve(ROOT, "data", "news.json"), JSON.stringify(payload), "utf8");

  // Sitemap: one URL per corridor so search engines can find corridor pages.
  // SITE_URL comes from site.txt if present, otherwise the sitemap is skipped.
  let site = "";
  try { site = (await readFile(resolve(ROOT, "site.txt"), "utf8")).trim().replace(/\/+$/, ""); } catch {}
  if (site) {
    const today = new Date().toISOString().slice(0, 10);
    const urls = ['<url><loc>' + site + '/</loc><lastmod>' + today + '</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>']
      .concat(corridors.slice(0, 900).map((c) =>
        '<url><loc>' + site + '/?corridor=' + encodeURIComponent(c.code) +
        '</loc><lastmod>' + c.last.slice(0, 10) + '</lastmod><changefreq>weekly</changefreq></url>'));
    await writeFile(resolve(ROOT, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join("\n") + "\n</urlset>\n", "utf8");
    console.log(`Wrote sitemap.xml - ${urls.length} URLs.`);
  }
  console.log(`\nWrote data/news.json - ${items.length} items, ${corridors.length} corridors, ` +
              `${sourceLog.filter((s) => s.status === "ok").length}/${sourceLog.length} sources ok.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
