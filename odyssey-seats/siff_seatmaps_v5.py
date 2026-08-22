"""
siff_seatmaps_v5.py -- full pipeline: capture -> autocrop -> HTML report

The Odyssey (70mm) seat-map monitor for SIFF Cinema Downtown.

NEW IN v5
---------
1. AUTOCROP: the seat-chart SVG letterboxes its drawing (big white bands top
   and bottom), so every capture is now post-processed with Pillow: find the
   bounding box of non-white content, pad 16px, crop in place. Install with
   `pip install pillow` (the run still works without it, just uncropped).
2. HTML REPORT: build_html_report() writes seat_maps/report.html --
   a self-contained page with an informational header (title, venue,
   capacity, engagement dates, explainer, legend), a dependency-free inline
   SVG line chart of percent-sold across all screenings (sold-out marked
   red), and a responsive card grid of the seat maps with color-coded
   status pills.
3. results.json is saved after each capture run; `--report-only` rebuilds
   the HTML from it without re-scraping (handy for styling iterations).

Usage:
    python siff_seatmaps_v5.py                # capture + report
    python siff_seatmaps_v5.py --report-only  # rebuild report from last run
"""

import html as html_mod
import json
import math
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

# Output dir is overridable so the multi-site build can place this site at
# dist/<slug>/ while a standalone run still writes to seat_maps/.
OUT = os.environ.get("OUT_DIR", "seat_maps")

os.makedirs(OUT, exist_ok=True)

MAIN_URL = "https://www.siff.net/cinema/in-theaters/the-odyssey"

VALID_70MM_DATES = [
    "July 16", "July 17", "July 18", "July 19", "July 20",
    "July 21", "July 22", "July 23", "July 24", "July 25",
    "July 26", "July 31", "August 1", "August 2",
]

ENGAGEMENT_NOTE = ("70mm engagement: July 16&ndash;26 &amp; July 31&ndash;"
                   "August 2, 2026 &middot; DCP screenings July 27&ndash;30 "
                   "&amp; August 3&ndash;13")

LIMIT = None      # e.g. 4 to smoke-test
WORKERS = 4       # parallel Playwright sessions (each fully independent)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

PACIFIC = ZoneInfo("America/Los_Angeles")
VIEWPORT = {"width": 1440, "height": 2400}

_SKIP_IFRAME_HOSTS = ("googletagmanager", "doubleclick", "facebook",
                      "youtube", "google.com", "recaptcha")

_MAP_EL_SEL = "canvas, svg"
_MAP_BOX_SEL = ("[class*='seat' i], [id*='seat' i], [class*='chart' i], "
                "[class*='venue' i], [class*='map' i], [id*='map' i]")
_MIN_W, _MIN_H = 250, 170

_STATUS_PATTERNS = [
    ("Sold Out", r"sold\s*out"),
    ("Seats Available", r"seats\s+available"),
    ("Almost Gone", r"almost\s+gone"),
    ("Standby", r"standby"),
]

_MONTHS = ["january", "february", "march", "april", "may", "june", "july",
           "august", "september", "october", "november", "december"]
_MONTH_NUM = {m: i + 1 for i, m in enumerate(_MONTHS)}
_MONTH_RX = ("January|February|March|April|May|June|July|August|September|"
             "October|November|December")

_print_lock = threading.Lock()
_pillow_warned = False


def _log(msg):
    with _print_lock:
        print(msg, flush=True)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _parse_month_day(text):
    m = re.search(rf"({_MONTH_RX})\s+(\d{{1,2}})", text or "", re.I)
    return (_MONTH_NUM[m.group(1).lower()], int(m.group(2))) if m else None


def _label(md):
    return f"{_MONTHS[md[0] - 1].capitalize()} {md[1]}"


def _dotnet_ms(value):
    m = re.search(r"\((-?\d+)", str(value or ""))
    return int(m.group(1)) if m else None


def _labels_from_ms(ms):
    dt = datetime.fromtimestamp(ms / 1000, tz=PACIFIC)
    # %-d / %-I are glibc (Linux); Windows would need %#d / %#I.
    return dt, dt.strftime("%B %-d"), dt.strftime("%-I:%M %p")


def _autocrop(path, pad=16, thresh=245):
    """Trim uniform white letterboxing around a capture, in place."""
    global _pillow_warned
    try:
        from PIL import Image
    except ImportError:
        if not _pillow_warned:
            _pillow_warned = True
            _log("  (install Pillow -- pip install pillow -- to auto-trim "
                 "the whitespace around seat maps)")
        return
    try:
        img = Image.open(path)
        mask = img.convert("L").point(lambda v: 255 if v < thresh else 0)
        bbox = mask.getbbox()
        if not bbox:
            return
        left, top, right, bottom = bbox
        left = max(left - pad, 0)
        top = max(top - pad, 0)
        right = min(right + pad, img.width)
        bottom = min(bottom + pad, img.height)
        if right - left >= 60 and bottom - top >= 60:
            img.crop((left, top, right, bottom)).save(path)
    except Exception as exc:
        _log(f"  autocrop failed for {path}: {exc}")


# --------------------------------------------------------------------------
# in-page javascript
# --------------------------------------------------------------------------

_TAG_JS = r"""
() => {
  const dateRe = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}/i;
  const timeRe = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
  const out = [];
  let lastDate = "";
  let idx = 0;
  for (const el of document.querySelectorAll("body *")) {
    const txt = (el.innerText || "").replace(/\u00a0/g, " ").trim();
    if (!txt) continue;
    const leafish = el.childElementCount === 0 || /^H[1-6]$/.test(el.tagName);
    if (leafish && txt.length < 60 && dateRe.test(txt)) {
      lastDate = txt.match(dateRe)[0];
    }
    if (el.childElementCount === 0 && timeRe.test(txt)) {
      el.setAttribute("data-sm-idx", String(idx));
      const clickable = el.closest("a,button") || el;
      let screening = null;
      const raw = clickable.getAttribute("data-screening");
      if (raw) { try { screening = JSON.parse(raw); } catch (e) {} }
      out.push({ idx: idx, date: lastDate,
                 time: txt.toUpperCase().replace(/\s+/g, " "),
                 screening: screening });
      idx += 1;
    }
  }
  return out;
}
"""

_CLUSTER_JS = r"""
() => {
  const cands = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.childElementCount > 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.width > 34 || r.height < 5 || r.height > 34) continue;
    if (Math.abs(r.width - r.height) > 10) continue;
    const tag = el.tagName.toLowerCase();
    let round = (tag === "circle" || tag === "ellipse");
    if (!round) {
      const br = parseFloat(getComputedStyle(el).borderRadius) || 0;
      round = br >= r.width * 0.25;
    }
    if (!round && !el.closest("svg")) continue;
    cands.push(r);
  }
  if (cands.length < 60) return null;
  const widths = cands.map(r => r.width).sort((a, b) => a - b);
  const med = widths[Math.floor(widths.length / 2)];
  const keep = cands.filter(r => r.width >= med * 0.6 && r.width <= med * 1.4);
  if (keep.length < 60) return null;
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const r of keep) {
    x1 = Math.min(x1, r.left);  y1 = Math.min(y1, r.top);
    x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
  }
  return { count: keep.length, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
"""


# --------------------------------------------------------------------------
# page plumbing
# --------------------------------------------------------------------------

def _dismiss_banners(page):
    for name in ("accept", "agree", "got it", "allow", "ok"):
        try:
            page.get_by_role("button", name=re.compile(name, re.I)).first \
                .click(timeout=800)
            time.sleep(0.3)
            return
        except Exception:
            continue


def _expand_showtimes(page):
    """The page hides all but ~3 days behind a 'View All Showtimes' button."""
    try:
        btn = page.get_by_text(re.compile(r"view\s+all\s+showtimes", re.I)).first
        if btn.is_visible():
            btn.click(timeout=2000)
            time.sleep(0.8)
    except Exception:
        pass


def _load_and_tag(page, dismiss=False):
    page.goto(MAIN_URL, timeout=60000, wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except PWTimeout:
        pass
    time.sleep(1.5)
    if dismiss:
        _dismiss_banners(page)
    _expand_showtimes(page)
    return page.evaluate(_TAG_JS)


def _read_status(page):
    for label, rx in _STATUS_PATTERNS:
        try:
            if page.get_by_text(re.compile(rx, re.I)).first.is_visible():
                return label
        except Exception:
            continue
    return "Unknown"


def _frame_offset(fr):
    if fr.parent_frame is None:
        return 0.0, 0.0
    try:
        box = fr.frame_element().bounding_box() or {}
        return box.get("x", 0.0) or 0.0, box.get("y", 0.0) or 0.0
    except Exception:
        return 0.0, 0.0


def _find_cluster(pg):
    best = None
    for fr in pg.frames:
        try:
            res = fr.evaluate(_CLUSTER_JS)
        except Exception:
            continue
        if not res:
            continue
        if not (150 <= res["w"] <= 2000 and 150 <= res["h"] <= 3000):
            continue
        ox, oy = _frame_offset(fr)
        res["x"] += ox
        res["y"] += oy
        if best is None or res["count"] > best["count"]:
            best = res
    return best


def _find_map_target(pg):
    vw, vh = pg.viewport_size["width"], pg.viewport_size["height"]
    size_js = """(els) => els.map(el => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
    })"""
    for sel in (_MAP_EL_SEL, _MAP_BOX_SEL):
        best = None
        for fr in pg.frames:
            try:
                sizes = fr.eval_on_selector_all(sel, size_js)
            except Exception:
                continue
            for i, s in enumerate(sizes):
                if s["w"] < _MIN_W or s["h"] < _MIN_H:
                    continue
                if s["w"] >= vw * 0.92 and s["h"] >= vh * 0.92:
                    continue
                cand = (fr, sel, i, s["w"] * s["h"])
                if best is None or cand[3] > best[3]:
                    best = cand
        if best:
            return best
    return None


def _map_ready(pg):
    return _find_cluster(pg) is not None or _find_map_target(pg) is not None


def _shoot_map(pg, shot_path):
    try:
        pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    try:
        pg.evaluate("window.scrollTo(0, 0)")
    except Exception:
        pass

    cluster, end = None, time.time() + 25
    while time.time() < end:
        cluster = _find_cluster(pg)
        if cluster:
            break
        time.sleep(0.5)

    if cluster:
        prev, settle_end = -1, time.time() + 10
        while time.time() < settle_end:
            cur = _find_cluster(pg)
            if cur and cur["count"] == prev:
                cluster = cur
                break
            prev = cur["count"] if cur else -1
            time.sleep(1.0)
        time.sleep(1.5)
        cluster = _find_cluster(pg) or cluster

        pad_x, pad_y = 40, 70
        vw, vh = pg.viewport_size["width"], pg.viewport_size["height"]
        x = max(cluster["x"] - pad_x, 0)
        y = max(cluster["y"] - pad_y, 0)
        w = min(cluster["w"] + 2 * pad_x, vw - x)
        h = min(cluster["h"] + 2 * pad_y, vh - y)
        try:
            pg.screenshot(path=shot_path,
                          clip={"x": x, "y": y, "width": w, "height": h})
            _autocrop(shot_path)
            return "cluster"
        except Exception:
            pass

    t = _find_map_target(pg)
    if t:
        fr, sel, nth, _ = t
        try:
            el = fr.locator(sel).nth(nth)
            el.scroll_into_view_if_needed()
            el.screenshot(path=shot_path)
            _autocrop(shot_path)
            return "element"
        except Exception:
            pass

    pg.screenshot(path=shot_path)
    return "viewport_fallback"


def _capture_one(page, new_pages, tag_idx, shot_path, console_errors, wid):
    frames_before = {f.url for f in page.frames}
    new_pages.clear()

    loc = page.locator(f'[data-sm-idx="{tag_idx}"]').first
    loc.scroll_into_view_if_needed()
    loc.click(timeout=8000)

    # ---- stage 1: the showtime dialog ----
    btn = page.get_by_text(re.compile(r"select\s+your\s+seats", re.I)).first
    sold = page.get_by_text(re.compile(r"sold\s*out", re.I)).first
    have_btn, sold_out = False, False
    end = time.time() + 15
    while time.time() < end:
        try:
            if btn.is_visible():
                have_btn = True
                break
        except Exception:
            pass
        try:
            if sold.is_visible():
                sold_out = True
                break
        except Exception:
            pass
        time.sleep(0.4)

    if sold_out and not have_btn:
        return {"status": "Sold Out", "url": None, "screenshot": None,
                "how": "dialog"}
    if not have_btn:
        page.screenshot(path=f"{OUT}/debug_w{wid}_no_dialog.png",
                        full_page=True)
        tail = " | ".join(console_errors[-6:]) or "none logged"
        raise RuntimeError("dialog never showed a 'Select your seats' button "
                           f"(recent JS errors: {tail})")

    status = _read_status(page)

    # ---- stage 2: click through to the seat map ----
    btn.click(timeout=8000)
    target_pg, url, how = None, None, None
    end = time.time() + 30
    while time.time() < end:
        if new_pages:
            target_pg = new_pages[0]
            try:
                target_pg.wait_for_load_state("domcontentloaded",
                                              timeout=15000)
            except PWTimeout:
                pass
            url, how = target_pg.url, "popup"
            break
        if page.url.split("#")[0].rstrip("/") != MAIN_URL.rstrip("/"):
            target_pg, url, how = page, page.url, "navigation"
            break
        if _map_ready(page):
            target_pg, how = page, "in_page"
            fresh = [f.url for f in page.frames
                     if f.url and f.url.startswith("http")
                     and f.url not in frames_before
                     and not any(h in f.url.lower()
                                 for h in _SKIP_IFRAME_HOSTS)]
            if fresh:
                url = next((u for u in fresh if "elevent" in u.lower()),
                           fresh[0])
            break
        time.sleep(0.5)

    if target_pg is None:
        page.screenshot(path=f"{OUT}/debug_w{wid}_after_select.png",
                        full_page=True)
        tail = " | ".join(console_errors[-6:]) or "none logged"
        raise RuntimeError("clicked 'Select your seats' but no seat map "
                           f"appeared (recent JS errors: {tail})")

    mode = _shoot_map(target_pg, shot_path)
    if how == "popup":
        try:
            target_pg.close()
        except Exception:
            pass
    return {"status": status, "url": url, "screenshot": shot_path,
            "how": f"{how}:{mode}"}


# --------------------------------------------------------------------------
# target discovery + worker orchestration
# --------------------------------------------------------------------------

def _shot_name(t):
    if t.get("_dt"):
        return f"{OUT}/seatmap_{t['_dt']:%Y-%m-%d_%H%M}.png"
    safe = re.sub(r"[^A-Za-z0-9]+", "-", f"{t['dlabel']}_{t['tlabel']}")
    return f"{OUT}/seatmap_{safe}.png"


def _match(entries, t):
    if t.get("ms"):
        m = next((e for e in entries if isinstance(e.get("screening"), dict)
                  and _dotnet_ms(e["screening"].get("Showtime")) == t["ms"]),
                 None)
        if m:
            return m
    return next((e for e in entries if e.get("date") == t.get("date")
                 and e.get("time") == t.get("time")), None)


def _entry(t, cap, event_page):
    sc = t.get("screening") or {}
    addr = ", ".join(x for x in [sc.get("VenueAddress1"),
                                 sc.get("VenueCity"),
                                 sc.get("VenueState")] if x)
    return {
        "date": t["dlabel"], "time": t["tlabel"],
        "status": cap.get("status"), "pct_sold": t.get("pct_sold"),
        "event_name": sc.get("EventName"),
        "venue": sc.get("VenueName"), "venue_address": addr or None,
        "capacity": sc.get("VenueCapacity"),
        "url": cap.get("url"), "screenshot": cap.get("screenshot"),
        "captured_via": cap.get("how"),
        "showtime_id": sc.get("ShowtimeId"),
        "full_date": t.get("date"), "epoch_ms": t.get("ms"),
        "event_page": event_page,
    }


def _worker(wid, my_targets, total, event_page):
    time.sleep(wid * 1.2)
    out = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=UA, viewport=VIEWPORT)
        new_pages, console_errors = [], []
        context.on("page", lambda pg: new_pages.append(pg))
        page = context.new_page()
        page.on("pageerror",
                lambda e: console_errors.append(f"pageerror: {e}"))
        page.on("console",
                lambda m: console_errors.append(m.text)
                if m.type == "error" else None)

        first_load = True
        for t in my_targets:
            n = t["_n"]
            pct = t.get("pct_sold")
            if pct is not None and pct >= 100:
                out.append(_entry(t, {"status": "Sold Out", "how": "json"},
                                  event_page))
                _log(f"  [{n}/{total}] {t['dlabel']} {t['tlabel']} -> "
                     f"Sold Out (100% sold per screening data, no click)")
                continue

            cap = None
            for attempt in (1, 2):
                try:
                    entries = _load_and_tag(page, dismiss=first_load)
                    first_load = False
                    m = _match(entries, t)
                    if m is None:
                        raise RuntimeError("showtime button not found after "
                                           "reload/expand")
                    cap = _capture_one(page, new_pages, m["idx"],
                                       _shot_name(t), console_errors, wid)
                    break
                except Exception as exc:
                    _log(f"  [{n}/{total}] {t['dlabel']} {t['tlabel']}: "
                         f"attempt {attempt} failed ({exc})")
            if not cap:
                continue
            out.append(_entry(t, cap, event_page))
            bits = [f"  [{n}/{total}] {t['dlabel']} {t['tlabel']} -> "
                    f"{cap.get('status')}"]
            if pct is not None:
                bits.append(f"[{pct:.1f}% sold]")
            if cap.get("screenshot"):
                bits.append(f"({cap['how']}) shot: {cap['screenshot']}")
            if cap.get("url"):
                bits.append(cap["url"])
            _log(" ".join(bits))

        browser.close()
    return out


def _summary(results):
    sold = sum(1 for r in results if r.get("status") == "Sold Out")
    shots = sum(1 for r in results if r.get("screenshot"))
    print(f"Found {len(results)} 70mm screenings: {shots} seat maps "
          f"captured, {sold} sold out.")
    if any("viewport_fallback" in (r.get("captured_via") or "")
           for r in results):
        print("  NOTE: some entries used viewport_fallback (send me one of "
              "those PNGs).")


def extract_70mm_showtimes():
    print("Step 1: Discovering 70mm showtimes on siff.net ...")
    valid = {_parse_month_day(d) for d in VALID_70MM_DATES}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=UA, viewport=VIEWPORT)
        page = context.new_page()
        entries = _load_and_tag(page, dismiss=True)
        browser.close()

    targets = []
    for e in entries:
        sc = e.get("screening")
        ms = _dotnet_ms(sc.get("Showtime")) if isinstance(sc, dict) else None
        if ms:
            dt, dlabel, tlabel = _labels_from_ms(ms)
            md = (dt.month, dt.day)
        else:
            dt, md = None, _parse_month_day(e.get("date"))
            dlabel = _label(md) if md else None
            tlabel = e.get("time")
        if md and md in valid:
            pct = None
            if isinstance(sc, dict):
                pct = sc.get("PublicAllocationSoldOutPercentage",
                             sc.get("CapacitySoldOutPercentage"))
            e.update(ms=ms, dlabel=dlabel, tlabel=tlabel, pct_sold=pct)
            e["_dt"] = dt
            targets.append(e)

    with open(f"{OUT}/screening_data.json", "w", encoding="utf-8") as f:
        json.dump([{"date": t["dlabel"], "time": t["tlabel"],
                    "screening": t.get("screening")} for t in targets],
                  f, indent=2, default=str)

    print(f"  {len(entries)} showtime buttons on page; {len(targets)} in "
          f"the 70mm windows.")
    if not targets:
        return []
    if LIMIT:
        targets = targets[:LIMIT]
        print(f"  LIMIT set -> only processing the first {LIMIT}.")

    for n, t in enumerate(targets, 1):
        t["_n"] = n

    ev_name = next((t["screening"].get("EventUrlName") for t in targets
                    if isinstance(t.get("screening"), dict)
                    and t["screening"].get("EventUrlName")), None)
    event_page = (f"https://www.goelevent.com/SIFF/e/{ev_name}"
                  if ev_name else None)

    n_workers = max(1, min(WORKERS, len(targets)))
    chunks = [targets[i::n_workers] for i in range(n_workers)]
    print(f"  Capturing with {n_workers} parallel sessions "
          f"({', '.join(str(len(c)) for c in chunks)} screenings each) ...")

    results = []
    with ThreadPoolExecutor(max_workers=n_workers) as pool:
        futures = [pool.submit(_worker, i, chunk, len(targets), event_page)
                   for i, chunk in enumerate(chunks)]
        for fut in futures:
            results.extend(fut.result())

    results.sort(key=lambda r: r.get("epoch_ms") or 2**62)
    _summary(results)
    return results


# --------------------------------------------------------------------------
# HTML report
# --------------------------------------------------------------------------

_CSS = """
:root { --ink:#2b2926; --sub:#6d675c; --line:#e7e2d8; --accent:#2f6f8f; }
* { box-sizing:border-box; }
body { margin:0; background:#faf8f3; color:var(--ink);
       font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif; }
.wrap { max-width:1180px; margin:0 auto; padding:32px 20px 60px; }
.kicker { text-transform:uppercase; letter-spacing:2px; font-size:12px;
          color:var(--accent); margin:0; font-weight:700; }
header h1 { margin:2px 0 6px; font-size:34px; letter-spacing:.5px; }
.sub { margin:2px 0; color:var(--sub); }
.explain { max-width:880px; line-height:1.55; }
.legend { display:flex; gap:22px; margin:12px 0 6px; color:var(--sub);
          font-size:14px; align-items:center; flex-wrap:wrap; }
.legend .dot { display:inline-block; width:12px; height:12px;
               border-radius:50%; margin-right:6px; vertical-align:-1px; }
.dot.taken { background:#b9b9b9; }
.dot.free { background:#fff; border:2px solid var(--accent); }
.links a { color:var(--accent); }
.chartbox { background:#fff; border:1px solid var(--line);
            border-radius:12px; padding:18px 18px 8px; margin:26px 0; }
.chartbox h2 { margin:0 0 10px; font-size:18px; }
.grid { display:grid; gap:18px;
        grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); }
.card { background:#fff; border:1px solid var(--line); border-radius:12px;
        padding:14px; }
.card-head { display:flex; justify-content:space-between;
             align-items:center; gap:8px; margin-bottom:10px; }
.card h3 { margin:0; font-size:16px; }
.card img { width:100%; height:auto; border-radius:6px; display:block; }
.pill { border-radius:999px; padding:3px 10px; font-size:12px;
        font-weight:700; white-space:nowrap; }
.pill-ok { background:#e8f2e9; color:#256a34; }
.pill-warm { background:#fdf0dd; color:#8a5a10; }
.pill-hot { background:#fbe3de; color:#a33323; }
.pill-sold { background:#a33323; color:#fff; }
.soldout { aspect-ratio:4/5; display:flex; align-items:center;
           justify-content:center; border:2px dashed #a33323;
           color:#a33323; border-radius:8px; font-weight:800;
           letter-spacing:3px; }
footer { margin-top:34px; color:var(--sub); font-size:13px; }
"""


def _svg_chart(rows):
    """Dependency-free inline SVG line chart of percent-sold per screening."""
    pts = [(r, r["pct_sold"]) for r in rows if r.get("pct_sold") is not None]
    if len(pts) < 2:
        return ""
    W, H, ml, mr, mt, mb = 1040, 300, 56, 16, 26, 62
    pcts = [p for _, p in pts]
    ymin = max(0, math.floor((min(pcts) - 3) / 5) * 5)
    ymax = 100
    iw, ih = W - ml - mr, H - mt - mb
    n = len(pts)

    def X(i):
        return ml + i * iw / (n - 1)

    def Y(p):
        return mt + (ymax - p) / (ymax - ymin) * ih

    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" '
             f'style="width:100%;max-width:{W}px;height:auto;display:block">']
    for k in range(int((ymax - ymin) / 5) + 1):
        yv = ymin + k * 5
        yy = Y(yv)
        parts.append(f'<line x1="{ml}" y1="{yy:.1f}" x2="{W - mr}" '
                     f'y2="{yy:.1f}" stroke="#e8e4dc" stroke-width="1"/>')
        parts.append(f'<text x="{ml - 8}" y="{yy + 4:.1f}" text-anchor="end" '
                     f'font-size="11" fill="#8a8578">{yv}%</text>')
    line = " ".join(f"{X(i):.1f},{Y(p):.1f}" for i, (_, p) in enumerate(pts))
    parts.append(f'<polyline points="{line}" fill="none" stroke="#2f6f8f" '
                 f'stroke-width="2.5" stroke-linejoin="round"/>')
    for i, (r, p) in enumerate(pts):
        x, y = X(i), Y(p)
        soldout = r.get("status") == "Sold Out"
        color = "#a33323" if soldout or p >= 99.95 else "#2f6f8f"
        title = (f'{r["date"]} {r["time"]} &middot; {p:.1f}% sold'
                 + (" (SOLD OUT)" if soldout else ""))
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" '
                     f'fill="{color}"><title>{title}</title></circle>')
        parts.append(f'<text x="{x:.1f}" y="{y - 9:.1f}" '
                     f'text-anchor="middle" font-size="10" '
                     f'fill="#5c5749">{p:.1f}</text>')
        ms = r.get("epoch_ms")
        if ms:
            dt = datetime.fromtimestamp(ms / 1000, tz=PACIFIC)
            l1, l2 = dt.strftime("%-m/%-d"), dt.strftime("%-I%p").lower()
        else:
            l1, l2 = r["date"], r["time"]
        parts.append(f'<text x="{x:.1f}" y="{H - mb + 18}" '
                     f'text-anchor="middle" font-size="11" '
                     f'fill="#5c5749">{l1}</text>')
        parts.append(f'<text x="{x:.1f}" y="{H - mb + 32}" '
                     f'text-anchor="middle" font-size="10" '
                     f'fill="#8a8578">{l2}</text>')
    parts.append("</svg>")
    return "".join(parts)


def _card(r):
    ms = r.get("epoch_ms")
    if ms:
        dt = datetime.fromtimestamp(ms / 1000, tz=PACIFIC)
        heading = dt.strftime("%a, %b %-d &middot; %-I:%M %p")
    else:
        heading = f'{r["date"]} &middot; {r["time"]}'
    pct = r.get("pct_sold")
    if r.get("status") == "Sold Out":
        pill = '<span class="pill pill-sold">SOLD OUT</span>'
        body = '<div class="soldout">SOLD OUT</div>'
    else:
        if pct is not None:
            cls = ("pill-hot" if pct >= 95
                   else "pill-warm" if pct >= 85 else "pill-ok")
            pill = f'<span class="pill {cls}">{pct:.1f}% sold</span>'
        else:
            pill = (f'<span class="pill pill-ok">'
                    f'{html_mod.escape(r.get("status") or "?")}</span>')
        shot = r.get("screenshot")
        if shot and os.path.exists(shot):
            body = (f'<img loading="lazy" '
                    f'src="{html_mod.escape(os.path.basename(shot))}" '
                    f'alt="Seat map, {heading}">')
        else:
            body = '<div class="soldout">NO CAPTURE</div>'
    return (f'<div class="card"><div class="card-head"><h3>{heading}</h3>'
            f'{pill}</div>{body}</div>')


def build_html_report(results, out_path=None):
    if out_path is None:
        out_path = f"{OUT}/report.html"
    meta = {}
    for r in results:
        for k in ("event_name", "venue", "venue_address", "capacity",
                  "event_page"):
            if not meta.get(k) and r.get(k):
                meta[k] = r[k]
    title = meta.get("event_name") or "The Odyssey"
    gen = datetime.now(PACIFIC).strftime("%A, %B %-d, %Y at %-I:%M %p %Z")
    n_maps = sum(1 for r in results if r.get("screenshot"))
    n_sold = sum(1 for r in results if r.get("status") == "Sold Out")
    cap = meta.get("capacity")

    ev_link = ""
    if meta.get("event_page"):
        ev_link = (' &middot; <a href="' + meta["event_page"]
                   + '">Event on Elevent</a>')

    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html_mod.escape(title)} &mdash; 70mm Seat Availability</title>
<style>{_CSS}</style></head>
<body><div class="wrap">
<header>
  <p class="kicker">70mm Seat Availability Report</p>
  <h1>{html_mod.escape(title)}</h1>
  <p class="sub">{html_mod.escape(meta.get("venue") or "")}
     &middot; {html_mod.escape(meta.get("venue_address") or "")}
     {f"&middot; {cap} seats" if cap else ""}</p>
  <p class="sub">{ENGAGEMENT_NOTE}</p>
  <p class="explain">Each panel below is a capture of the live
     reserved-seating chart for one 70mm screening, taken directly from
     SIFF's Elevent ticketing widget on {gen}. {n_maps} seat map(s)
     captured; {n_sold} screening(s) already sold out. Availability changes
     constantly &mdash; treat this as a snapshot.</p>
  <div class="legend">
    <span><i class="dot taken"></i> Taken</span>
    <span><i class="dot free"></i> Available at capture</span>
    <span>&#9855;&nbsp; Accessible seating</span>
  </div>
  <p class="links"><a href="{MAIN_URL}">Tickets at siff.net</a>{ev_link}</p>
</header>
<section class="chartbox">
  <h2>How sold is each screening?</h2>
  {_svg_chart(results)}
</section>
<section class="grid">
{chr(10).join(_card(r) for r in results)}
</section>
<footer>Generated {gen}.</footer>
</div></body></html>"""

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)
    return out_path


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

if __name__ == "__main__":
    if "--report-only" in sys.argv:
        try:
            with open(f"{OUT}/results.json", encoding="utf-8") as f:
                results = json.load(f)
        except FileNotFoundError:
            print(f"No {OUT}/results.json yet -- run once without "
                  "--report-only first.")
            sys.exit(1)
    else:
        results = extract_70mm_showtimes()
        with open(f"{OUT}/results.json", "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        for s in results:
            pct = (f'{s["pct_sold"]:.1f}%'
                   if s.get("pct_sold") is not None else "-")
            print(f'{s["date"]:>10} {s["time"]:>8}  {s["status"]:>15} '
                  f'{pct:>7}  {s["screenshot"] or "-"}')

    if results:
        print(f"Report -> {build_html_report(results)}")