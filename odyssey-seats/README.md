# Odyssey 70mm Seat Maps

Captures the live reserved-seating chart for every 70mm screening of *The Odyssey* at
SIFF Cinema Downtown, and builds a report with a percent-sold trend and a card grid of
seat maps. Published at
**https://jackchammons.github.io/sites/odyssey-seats/**

```bash
pip install playwright pillow && playwright install chromium
python3 siff_seatmaps_v5.py                # capture + report
python3 siff_seatmaps_v5.py --report-only  # rebuild the HTML from the last capture
OUT_DIR=/tmp/out python3 siff_seatmaps_v5.py   # write somewhere else
```

Output goes to `OUT_DIR` (default `seat_maps/`): `report.html`, one PNG per screening,
plus `results.json` and `screening_data.json`. The multi-site build sets `OUT_DIR` to
`dist/odyssey-seats/` and promotes `report.html` to `index.html`.

## The two SIFF pages

SIFF lists this film twice — a digital/DCP page and a dedicated 70mm page:

- `MAIN_URL` → `…/the-odyssey-(70mm)` — what we scrape
- `DIGITAL_URL` → `…/the-odyssey` — digital screenings, deliberately not tracked

Because we target the 70mm page directly, **every showtime found is a 70mm screening**
and the header's engagement range is derived from what was actually captured. There is
no date list to keep up to date.

This matters: the original version scraped the combined page and filtered by a hardcoded
list of July 2026 dates. When SIFF split the listings, that filter silently matched
nothing and the site showed an empty state that looked like "the run ended" rather than
"the scraper is pointed at the wrong page".

## Empty results are not a failure

If the page loads and lists no 70mm screenings, the script exits cleanly with no report
and the site build renders a placeholder — the engagement really is over. A *failure* to
load raises instead, which fails the publish run and leaves the previous deploy live.
