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

// Words that appear in front of "Expressway" in a sentence but are not part of
// any corridor's name. Without this the extractor invents corridors such as
// "Largest Greenfield Expressway" or "Probes Fatal Expressway".
const EXP_STOPWORDS = new Set(["the","this","that","a","an","of","on","at","in","to","from","and","for","with","its","their","our","his","her",
  "new","old","first","second","third","next","last","latest","upcoming","proposed","planned","under","along","near","via","across","between",
  "probes","fatal","crash","largest","biggest","longest","shortest","growth","progress","express","key","major","big","huge","mega","full","total","entire","whole",
  "km","kms","kilometre","kilometres","kilometer","kilometers","crore","lakh","rs","access","controlled","six","eight","four","two","lane","laned","laning",
  "india","indias","national","state","greenfield","brownfield","elevated","said","says","work","police","update","corridor"]);

// "Lucknow-Kanpur" and "Kanpur-Lucknow" are the same road, so endpoint pairs are
// ordered alphabetically before a code is made.
function canonExpressway(name) {
  let base = String(name).replace(/\s+Expressway$/i, "").trim();
  let tokens = base.split(/\s+/);
  while (tokens.length && EXP_STOPWORDS.has(tokens[0].toLowerCase())) tokens.shift();
  while (tokens.length && EXP_STOPWORDS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  if (!tokens.length) return null;
  base = tokens.join(" ");
  const pair = base.split(/[-\u2013]/).map((x) => x.trim()).filter(Boolean);
  if (pair.length === 2 && pair.every((x) => /^[A-Z][A-Za-z]+$/.test(x))) {
    base = pair.slice().sort((a, b) => a.localeCompare(b)).join("-");
  }
  if (base.replace(/[^A-Za-z]/g, "").length < 4) return null;
  return base + " Expressway";
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

  const addExpressway = (rawName) => {
    const label = canonExpressway(rawName);
    if (!label) return;
    const code = "EXP:" + label.replace(/\s+/g, "-");
    if (!found.has(code)) found.set(code, { code, kind: "EXP", label });
  };

  // Named corridors from the list
  const lower = text.toLowerCase();
  for (const name of NAMED_EXPRESSWAYS) {
    if (!lower.includes(name.toLowerCase())) continue;
    if (/expressway/i.test(name)) { addExpressway(name); continue; }
    const code = "EXP:" + name.replace(/\s+/g, "-");
    found.set(code, { code, kind: "EXP", label: name });
  }

  // Any other "<Something> Expressway" phrase
  const reExp = /\b([A-Z][A-Za-z]+(?:[-\u2013][A-Z][A-Za-z]+)*(?:\s[A-Z][A-Za-z]+)?)\s+Expressway\b/g;
  while ((m = reExp.exec(text)) !== null) addExpressway(m[1] + " Expressway");

  return [...found.values()].slice(0, 8);
}

/* ================================================================== */
/* PIB All Releases page                                               */
/* ================================================================== */

// PIB's RSS is governed by server-side session state and comes back in Hindi
// whatever the query string says. The All Releases page does honour reg and
// lang, and it groups releases under the issuing ministry, which the feed
// never gave us. So we read that page instead.

// Everything these ministries issue is in scope, whatever the headline says.
const PIB_CORE_MINISTRIES = [
  "Road Transport", "Surface Transport", "Railways", "Ports, Shipping", "Shipping",
  "Waterways", "Civil Aviation",
  "Cabinet Committee on Infrastructure", "Cabinet Committee on Economic Affairs",
];

// Other ministries publish plenty that matters, but also a lot that does not,
// so their releases still have to clear the keyword test below.
const pibCoreMinistry = (m) =>
  PIB_CORE_MINISTRIES.some((x) => lc(m || "").includes(lc(x)));

function parsePibAllRel(html) {
  const out = [];
  let ministry = "";

  // Walk headings and release links in document order so each release
  // inherits the ministry heading that sits above it.
  const re = /<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>|<a[^>]+href="([^"]*PressRelease[^"]*PRID=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const h = stripTags(m[1]);
      if (h && h.length < 90) ministry = h;
      continue;
    }
    const url = decodeEntities(m[2]).replace(/&amp;/g, "&");
    const title = stripTags(m[3]);
    if (!title || title.length < 15) continue;
    out.push({
      title,
      link: url.startsWith("http") ? url : "https://www.pib.gov.in/" + url.replace(/^\/+/, ""),
      ministry,
      published: new Date().toUTCString(),
      summary: "",
    });
  }

  // The same release can be linked more than once on the page.
  const seen = new Set();
  return out.filter((i) => {
    const key = (i.link.match(/PRID=(\d+)/) || [])[1] || i.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

const TRANSPORT_GATE = ["highway","road","toll","nhai","morth","expressway","railway","rail","train","airport","aviation","airline","port","shipping","cargo","logistics","freight","transport","metro","bridge","corridor","waterway","vehicle","traffic","fastag","gati shakti",
  // demand-side indicators: no transport word in the headline, but these are
  // what a traffic forecast is anchored against
  "wholesale price index","consumer price index","index of industrial production","gross domestic product","gdp","e-way bill","gst collection","core sector","iip","mining production","coal production","steel production","cement production"];

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

// Remove the trailing publisher name, and the echoed headline, from a summary.
function stripPublisher(summary, publisher, headline) {
  let out = String(summary || "");
  if (!out) return "";
  for (const needle of [publisher, headline]) {
    if (!needle) continue;
    const esc = String(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\s*" + esc + "\\s*$", "i"), " ");
    out = out.replace(new RegExp("^\\s*" + esc + "\\s*", "i"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function splitGoogleTitle(title) {
  const m = title.match(/^(.*)\s+-\s+([^-]{2,60})$/);
  return m ? { headline: m[1].trim(), publisher: m[2].trim() } : { headline: title, publisher: "" };
}

const normaliseKey = (t) =>
  lc(t).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);

// Counting how many outlets carried a story only works if near-identical
// headlines are recognised as the same event. Exact matching misses them:
// "freight loading rises 5.4% to 137.9 MT" and "freight loading up 5.4% to
// 137.9 million tonnes" are one story written two ways.
const WORD_STOP = new Set(["the","and","for","with","from","that","this","into","over","after","says","said","will","have","has","been","its","are","was","were","than","then","also","amid","more","most","new","says","report","reports","india","indian","crore","lakh","per","cent","percent"]);

function titleWords(title) {
  return new Set(
    lc(title).replace(/[^a-z0-9. ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !WORD_STOP.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Distinctive figures are the strongest clue that two headlines describe one
// event: "137.9 MT", "17 bids", "Rs 8,300 crore". Years are excluded because
// every story in a month carries the same one.
function titleNumbers(title) {
  const out = new Set();
  for (const m of String(title).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const n = parseFloat(raw);
    if (!isFinite(n)) continue;
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue;   // a year
    if (!raw.includes(".") && raw.length < 2) continue;            // single digit
    out.add(raw);
  }
  return out;
}

const SIMILARITY = 0.55;      // share most of their distinctive words, or
const SIMILARITY_NUM = 0.3;   // share some words plus a distinctive figure
const WINDOW_DAYS = 10;       // and appear within ten days of each other

function sameEvent(a, b) {
  const j = jaccard(a.words, b.words);
  if (j >= SIMILARITY) return true;
  if (j < SIMILARITY_NUM) return false;
  for (const n of a.nums) if (b.nums.has(n)) return true;
  return false;
}

// Group near-duplicate reports of the same event, keeping one representative
// and counting the distinct outlets behind it.
function clusterDuplicates(items) {
  const clusters = [];
  for (const item of items) {
    const words = titleWords(item.title);
    const nums = titleNumbers(item.title);
    const when = new Date(item.published).getTime();
    let placed = false;

    for (const c of clusters) {
      if (c.mode !== item.mode) continue;
      if (Math.abs(when - c.when) > WINDOW_DAYS * 864e5) continue;
      if (!sameEvent({ words, nums }, c)) continue;

      (item.publishers || [item.publisher]).forEach((x) => { if (x) c.publishers.add(x); });
      // Prefer a government release, otherwise the earliest report, which sits
      // closest to the event itself.
      if ((item.official && !c.rep.official) ||
          (item.official === c.rep.official && when < c.when)) {
        c.rep = item; c.when = when;
      }
      placed = true;
      break;
    }

    if (!placed) {
      clusters.push({
        rep: item, words, nums, when, mode: item.mode,
        publishers: new Set((item.publishers || [item.publisher]).filter(Boolean)),
      });
    }
  }

  return clusters.map((c) => ({
    ...c.rep,
    corroboration: Math.max(c.publishers.size, c.rep.corroboration || 1),
    publishers: [...c.publishers].slice(0, 12),
  }));
}

function toISO(d) {
  const x = new Date(d);
  return isNaN(x.getTime()) ? null : x.toISOString();
}

async function fetchText(url, cookie) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (compatible; Chainage/1.0)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(url, { signal: ctrl.signal, headers, redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

// PIB stores the language and region choice server-side against a session, so
// asking for Lang=1 on the RSS URL alone silently returns nothing. Visiting the
// index page first sets the cookies that make the feed return English releases.
async function warmSession(warmUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(warmUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Chainage/1.0)" },
      redirect: "follow",
    });
    const jar = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
    return jar.map((c) => String(c).split(";")[0]).join("; ");
  } catch { return ""; }
  finally { clearTimeout(timer); }
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
      const cookie = t.warm ? await warmSession(t.warm) : "";
      let items = t.type === "pib-allrel"
        ? parsePibAllRel(await fetchText(t.url))
        : parseFeed(await fetchText(t.url, cookie));

      // Publishers rate-limit intermittently and answer with an empty feed
      // rather than an error, so one quiet retry is worth it.
      if (!items.length) {
        await new Promise((r) => setTimeout(r, 2500));
        items = t.type === "pib-allrel"
          ? parsePibAllRel(await fetchText(t.url))
          : parseFeed(await fetchText(t.url, cookie));
      }
      // Some official feeds return an empty shell if the session did not take.
      if (!items.length && t.fallback) {
        console.log(`  ..    ${t.name} returned nothing, trying fallback`);
        items = parseFeed(await fetchText(t.fallback));
      }
      let kept = 0;
      for (const raw of items) {
        const byMinistry = pibCoreMinistry(raw.ministry);
        if (t.gate && !byMinistry && !isTransportRelevant(raw)) continue;
        const { headline, publisher } = t.official
          ? { headline: raw.title, publisher: t.publisher }
          : splitGoogleTitle(raw.title);
        const iso = toISO(raw.published);
        if (!iso || !raw.link) continue;
        const pub = raw.feedSource || publisher || t.publisher || t.name;

        // Google News appends the publisher to the description. Left in, an
        // article from "Punjab Kesari" about Maharashtra gets tagged Punjab and
        // "Telangana Today" tags every story Telangana. Strip it before tagging.
        const cleanSummary = stripPublisher(raw.summary, pub, headline);

        fresh.push({
          title: headline,
          url: raw.link,
          publisher: pub,
          official: !!t.official,
          published: iso,
          summary: cleanSummary.slice(0, 320),
          ministry: raw.ministry || undefined,
          ...classify(headline, cleanSummary + " " + (raw.ministry || "")),
        });
        kept++;
      }
      // PIB keeps the language against the session rather than the query
      // string, so a feed can come back in Hindi whatever Lang says. The
      // English keyword filter then drops everything, which looks like a dead
      // source unless we say so plainly.
      const devanagari = items.filter((i) => /[\u0900-\u097F]/.test(i.title)).length;
      const note = devanagari > items.length / 2 ? " - feed came back in Hindi, session language did not take"
                 : items.length !== kept ? ` (of ${items.length} fetched, rest filtered out)` : "";

      sourceLog.push({ name: t.name, status: "ok", items: kept, fetched: items.length,
                       hindi: devanagari > items.length / 2 || undefined });
      console.log(`  ok    ${t.name} - ${kept}${note}`);
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
  const deduped = [...byKey.values()]
    .filter((i) => new Date(i.published).getTime() >= cutoff)
    .sort((a, b) => new Date(b.published) - new Date(a.published));

  const before = deduped.length;
  const items = clusterDuplicates(deduped)
    .sort((a, b) => new Date(b.published) - new Date(a.published))
    .slice(0, MAX_ITEMS)
    .map((i, idx) => ({ ...i, id: "c" + idx + "-" + normaliseKey(i.title).slice(0, 20).replace(/ /g, "_") }));
  console.log(`Grouped ${before} reports into ${items.length} events.`);

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
