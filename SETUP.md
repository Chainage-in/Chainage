# Chainage setup

India transport corridor monitor. No terminal, no coding. About 10 minutes in your browser.
Free to run: GitHub Pages and GitHub Actions cost nothing for public repositories.

---

## 1. Create the repository

1. Go to **github.com** and sign in (free account, email and username only).
2. Click **+** top right → **New repository**.
3. Name it `chainage`. Set it **Public**. Do not tick "Add a README".
4. Click **Create repository**.

## 2. Upload the files

1. On the empty repository page, click **uploading an existing file**.
2. Drag in everything from the `chainage` folder, keeping the structure:
   `index.html`, `feeds.json`, `robots.txt`, `SETUP.md`, and the `scripts`, `data` and `.github` folders.
3. Click **Commit changes**.

> If `.github` doesn't appear when you drag, your file browser is hiding it. Windows: press
> **Alt** and tick *Hidden items* under the View tab. Mac: press **Cmd + Shift + .** in Finder.

## 3. Let the collector write back

**Settings** → **Actions** → **General** → scroll to **Workflow permissions** → select
**Read and write permissions** → **Save**.

Without this, nothing updates.

## 4. Turn the website on

**Settings** → **Pages** → Source: **Deploy from a branch** → Branch **main**, folder **/ (root)**
→ **Save**.

Wait a minute, reload, and your address appears at the top:
`https://<your-username>.github.io/chainage/`

## 5. Collect the first batch

**Actions** tab → enable workflows if prompted → **Update feeds** in the sidebar →
**Run workflow** → **Run workflow**.

About a minute. Green tick, then open your address.

From here it refreshes on its own at roughly 06:30, 13:30 and 19:30 IST, every day. The workflow
re-arms its own schedule each run, so GitHub's 60-day inactivity cut-off won't silently stop it.

---

## Using it

### All news
The lane board filters by mode. Chips filter by event type. The status filter separates
*proposed* from *sanctioned*, *awarded*, *under construction* and *open to traffic*, headlines
blur these constantly, so use it before treating anything as built.

A badge reading **3 SOURCES** means three different outlets carried that story. One outlet
reporting an award is weaker evidence than five.

### By corridor
Pick any NH, SH, AH, MDR or expressway that has appeared in the news. You get:

- **What has happened**: events already on the ground, newest first, grouped by year. This is
  the chronology you write a justification narrative from.
- **What is coming**: announced, sanctioned, awarded or under construction, sorted by the target
  year the source stated. These are claims, not commitments.
- **Corridors nearby**: other corridors turning up in the same states. Some compete for your
  traffic, some feed it. Open each one and judge it; the tool does not decide this for you.

Corridor tags appear on every headline. Click one to jump straight to that corridor.

### Data and charts
The Timeline tab opens with a **Data** panel. Pick one or more series, set a date window, switch
between line and bar, and download what is on screen as **CSV** or **Excel**. On a corridor page
the same panel appears filtered to that corridor, so plaza level series tagged to it show up
there automatically.

Series come from two places. IHMCL's national ETC transaction and collection figures are read
automatically each run. Everything else you supply as CSV in the `data-drop` folder, which is
explained below.

### Source reports
Below the Data panel, Chainage lists and links every monthly plaza level report IHMCL publishes,
newest first, sorted by month. Open the one you need and copy the rows for your plazas into a
CSV. Read the publisher's disclaimer, reproduced on that panel, before using any of it.

### Events on record
Below the news list on the Timeline tab. Filter by event type or by mode, or search it. Use it
when you need to explain a step in a series: check what else was happening that quarter before
you attribute the move to anything local.

### Accessibility toolbar
The dark bar at the top carries the controls Indian government sites conventionally provide:
**A&minus; / A / A+** to change text size, and **High contrast** for a black-and-yellow mode.
Both remember your choice on that browser. There is also a skip-to-content link for keyboard
and screen-reader users.

### Saving items
Press Save on any item to keep it with your own note. The corridor field pre-fills where one was detected. Add your
assessment and a note on what it changes and when.

**Download CSV** or **Download Excel** gives you: your note and assessment, the headline,
publisher, how many sources carried it, publication date, claimed status, signal, target year,
mode, states, corridors, and the URL.
Ready to paste into a report.

Saved items live in the browser you made them in. They are not synced and not backed up. Download what you want to keep.

---

## A note on the look

The interface follows the visual conventions of Indian government websites, the blue banner and
boxed panels, the tricolour rule, the text-size and high-contrast controls, the "Last updated on"
footer stamp.

The State Emblem of India is deliberately **not** used. Its use is restricted under the State
Emblem of India (Prohibition of Improper Use) Act, and this is not a government site. The footer
carries an explicit line saying so, which you should leave in place.

## Getting your own data in

Chainage reads any CSV you put in the `data-drop` folder and turns it into a chart with
downloads. Upload the file through GitHub's website the same way you uploaded everything else,
then run **Update feeds** from the Actions tab.

The format needs three columns, `series`, `date` and `value`, plus optional `unit`, `category`,
`region`, `corridor`, `plaza`, `source` and `sourceurl`. Dates can be written as `2024-06`,
`2024`, `FY-24-25`, `Apr-2024` or `Q1 2024`. Full instructions and a working template are in
`data-drop/README.md`.

### What can and cannot be collected automatically

This matters, so here it is plainly.

| Source | Automatic? | Why |
| --- | --- | --- |
| IHMCL national ETC series | **Yes** | Published as a plain table on their page, read every run |
| IHMCL plaza level monthly data | Links only | Published as PDFs. Chainage lists every month; you copy the rows you need |
| MoSPI GDP and GSDP | No | Published as spreadsheets and releases, not a feed. Download and drop |
| VAHAN vehicle registrations | No | No public API, and automated access is blocked. Export from the dashboard and drop |
| WPI from the Office of the Economic Adviser | No | Published as monthly spreadsheets. Download and drop |
| Consensus Economics, S&P Global Market Intelligence (formerly IHS Markit) | No | Paid subscriptions with no free route. Free alternatives are the IMF World Economic Outlook and World Bank open data |
| Commodity and trade news | **Yes** | Already collected through the existing feeds |

Anything in the "No" rows takes about five minutes a month: download, paste into a CSV with the
right column names, upload. That is deliberately a manual step. A scraper against a login wall or
a PDF layout would break without warning, and a number that is silently three months stale is
worse than no number at all.

## Historical depth

Chainage has three layers of history, and they are not equal. Know which you are looking at.

**1. Macro Timeline (2008 onward).** A curated chronology of the economic, environmental, social
and geopolitical events that moved Indian traffic: the Karnataka and Goa mining bans, the toll
suspension during demonetisation, the GST rollout, the 2018 axle-load revision, the COVID lockdown
and its toll suspension, the farmers' blockades, the Red Sea disruption, Kumbh years, major
cyclones and floods.

Each entry says **how the event reached transport**, which is the part you need for a narrative.
A green **DATE CHECKED** badge means the date was verified against a source; the rest are
starting points. None of it is a citation, so chase the primary source before it goes in a study.

The file is `history/macro-events.json`. Add your own rows in the same shape: date, title, kind,
mechanism, modes, regions. What you know that the sources do not belongs here.

**2. Corridor Background (Wikipedia).** For each corridor on record, a dated chronology pulled
from its Wikipedia article: when it was renumbered, four-laned, bypassed, opened. It appears as a
**Background** section on the corridor page, with a link to the article. Reference only. Wikipedia
is a tertiary source; use it to find roughly when something happened, then chase the citation.
This refreshes daily and skips corridors checked within the last 30 days.

**3. Collected news (from the day you first run it).** Google News reaches back weeks, not years,
so this layer starts thin and compounds. The collector keeps everything it has ever collected.

### Getting PIB history in

PIB's archive holds government releases back to 1947, but it is an ASP.NET site that needs
form-based navigation, so it cannot be collected automatically without a scraper that will break.
Use it by hand instead: go to **archive.pib.gov.in**, search by keyword or pick a ministry and
year, and add anything worth keeping as a row in `history/macro-events.json`. For MoRTH toll
notifications, cabinet approvals and corridor sanctions, this is the best free primary source
there is.

### What is not achievable for free

Twenty years of Indian news headlines is not available from any free API. GDELT's article search
is capped at a rolling three-month window. Its raw archives reach 2015 but need a Google Cloud
billing account, and a decade-wide query costs real money. Factiva, LexisNexis and ProQuest do
have the full range, if your organisation ever gets a subscription, that is the route.

## One limitation to know before you rely on it

**Chainage has no history before the day you first run it.** Google News feeds reach back weeks,
not years. A corridor page will look thin at first and fill out over months as the archive builds.
The collector keeps everything it has ever collected, so the record compounds, but it cannot
reconstruct 2019-2025 for you.

For older history, use Chainage from today forward and search the archives by hand for the back years.

---

## Being found in search

Chainage ships with the basics: descriptive title and description, structured data, `robots.txt`,
and a `sitemap.xml` listing every corridor page.

**To switch the sitemap on**, create a file called `site.txt` in your repository containing just
your address, on one line:

```
https://your-username.github.io/chainage
```

Then edit `robots.txt` and replace `REPLACE-WITH-YOUR-USERNAME` with the same address. Run
**Update feeds** again and `sitemap.xml` will be generated.

**To get indexed faster**, go to **search.google.com/search-console**, add your address as a
property, verify it (the HTML tag method is easiest, paste the tag into `index.html` just below
`<title>`), and submit your sitemap.

**Set your expectations honestly.** A brand-new site will not rank for competitive searches like
"transport news India", those belong to established outlets with years of authority. What is
realistic within a few months: ranking for "Chainage" itself, and picking up long-tail searches
like "NH-27 traffic news" or "Purvanchal Expressway toll update" where competition is thin. The
main value stays what it was built for, you and your team finding a corridor's history in
seconds.

---

## Adding or removing sources

Open `feeds.json` on GitHub, click the pencil icon.

A Google News source needs only a plain-English `query`:
```json
{ "name": "Ropeway projects", "query": "India ropeway OR cable car project sanctioned", "gate": false }
```

A direct RSS feed needs a `url` instead, and `"gate": true` if it's broad:
```json
{ "name": "State PWD", "url": "https://example.gov.in/rss.xml", "publisher": "PWD", "official": true, "gate": true }
```

Commit, then run **Update feeds** to see the effect.

---

## If something looks wrong

- **"No headlines collected yet"**, the workflow hasn't run, or step 3 was skipped. Check the
  Actions tab for a red cross.
- **"Some sources failed"**, normal and temporary; publishers rate-limit. If one fails every
  time, its URL has changed. Remove it from `feeds.json`.
- **An item is on the wrong corridor, or the status looks wrong**, tagging is worked out from
  wording, not from a database. It's a starting point. Verify at package or section level before
  relying on it.
