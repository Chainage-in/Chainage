# data-drop

Put CSV files here and they become charts on the Timeline tab, with download
buttons for CSV and Excel.

This folder exists because most useful sources do not publish anything a machine
can read on a schedule. VAHAN has no public API and blocks automated
access. MoSPI and the Office of the Economic Adviser publish spreadsheets and
press releases, not feeds. IHMCL publishes plaza level data as monthly PDFs.
Rather than ship scrapers that break silently, the tool reads whatever you put
here.

## Format

One row per data point. Three columns are required.

| column | required | what goes in it |
| --- | --- | --- |
| `series` | yes | Name of the line, e.g. `WPI All Commodities` |
| `date` | yes | `2024-06`, `2024-06-01`, `2024`, `FY-24-25`, `Apr-2024` or `Q1 2024` |
| `value` | yes | The number. No commas, no units. |
| `unit` | no | `index`, `Rs crore`, `lakh vehicles`, `PCU` |
| `category` | no | Groups series in the picker, e.g. `Prices`, `Output`, `Toll` |
| `region` | no | State or `India` |
| `corridor` | no | `NH-27`, `Purvanchal Expressway` |
| `plaza` | no | Plaza name, for plaza level series |
| `source` | no | Where it came from, e.g. `MoSPI`, `IHMCL Aug 2026 report` |
| `sourceurl` | no | Link back to the source page |

Column order does not matter. Extra columns are ignored. Add as many files as
you like, one per source is tidiest.

## Where to get each thing

**Plaza level volumes and collections.** IHMCL publishes a VC Wise Monthly ETC FASTag
Report at ihmcl.co.in/etc-transaction-reports as a PDF for each month, broken
down by plaza and vehicle class. The Timeline tab lists and links every one of
these automatically. Open the month you need and copy the rows you want into a
CSV here, filling in `plaza` and `corridor`.

Read the publisher's own disclaimer before using any of it. They state the
figures are subject to later adjustment and reconciliation, make no warranty as
to accuracy or finality, and advise against relying on them for any commercial
decision. Treat them as indicative and check against the operator or authority.

**GDP and GSDP.** MoSPI publishes National Accounts and state series at
mospi.gov.in. Download the relevant table, keep the year and value columns, and
save in the format above with `region` set to India or the state.

**Vehicle registrations.** The VAHAN dashboard at
vahan.parivahan.gov.in/vahan4dashboard lets you filter by state, category and
month and export. There is no public API, so this one is always a manual export.

**WPI.** The Office of the Economic Adviser publishes the monthly index at
eaindustry.nic.in, including commodity level detail. Useful series: all
commodities, fuel and power, and individual commodities such as cement, steel
and coal.

**Global forecasts.** Consensus Economics and S&P Global Market Intelligence,
formerly IHS Markit, are paid subscriptions with no free or automated route. The
IMF World Economic Outlook and World Bank open data are free alternatives that
publish downloadable series.

## Template

`template.csv` in this folder has the header row and a few example rows. Copy it,
replace the rows, keep the header.
