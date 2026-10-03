"""Tests and calibration for scripts/footprint.py.

Run: uv run --with pytest pytest evals/test_footprint.py
Calibration report: uv run --with pytest pytest evals/test_footprint.py -s -k calibration

Corpora are generated in a tmp dir:
  city_swap  5 pages from one template, only the city changes   -> expect >= 0.9
  enriched   5 location pages, shared frame, own local content   -> expect <= 0.5
  vs         3 vs pages, shared frame, different comparison tables
  local-chain fixture template rendered for its 12 premises clinics
"""

from __future__ import annotations

import functools
import http.server
import importlib.util
import itertools
import json
import re
import subprocess
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "footprint.py"
FIXTURES = ROOT / "evals" / "fixtures"
_spec = importlib.util.spec_from_file_location("footprint", SCRIPT)
footprint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(footprint)

CHROME_TOP = """<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<title>{title}</title><script>window.dataLayer=[]</script><style>body{{margin:0}}</style></head><body>
<div class="cookie-banner">We use cookies to improve your visit. Accept all or manage your preferences.</div>
<header><a href="/">{brand}</a><nav><a href="/locations">Locations</a><a href="/services">Services</a>
<a href="/prices">Prices</a><a href="/book">Book</a></nav></header>
<main>"""
CHROME_BOTTOM = """</main><footer><p>{brand} Ltd, registered in England. Company number 0123456.</p>
<a href="/privacy">Privacy</a> <a href="/terms">Terms</a></footer></body></html>"""


def page(brand: str, title: str, body: str) -> str:
    return CHROME_TOP.format(brand=brand, title=title) + body + CHROME_BOTTOM.format(brand=brand)


# --- corpus (a): city-swap doorway pages ---------------------------------

CITIES = ["Bristol", "Bath", "Swindon", "Gloucester", "Cheltenham Spa"]
SWAP_TEMPLATE = """
<h1>Best physiotherapist in {c}</h1>
<p>Looking for a physiotherapist in {c}? Fernlea Physio {c} is the leading physiotherapy clinic for
people in {c} and the surrounding area. Our {c} physiotherapists treat back pain, sports injuries,
neck pain and post-surgery rehabilitation. Whether you live in {c} or nearby, our friendly {c} team
is here to help you move better and feel better.</p>
<h2>Why choose Fernlea Physio {c}?</h2>
<ul><li>Experienced, fully qualified physiotherapists</li><li>Same-week appointments in {c}</li>
<li>Self-pay and insured patients welcome</li><li>Evening and weekend sessions</li></ul>
<h2>Physiotherapy services in {c}</h2>
<p>We offer sports massage, acupuncture, pilates-based rehab and workplace assessments in {c}.
Every treatment plan starts with a full assessment so we understand your goals. Patients across
{c} trust us to get them back to the activities they love.</p>
<h2>Book a physio in {c} today</h2>
<p>Book online in under two minutes or call our {c} clinic. New patients in {c} get a free
fifteen-minute phone consultation before their first visit.</p>
"""


def city_swap() -> dict[str, str]:
    return {
        f"{c.lower().replace(' ', '-')}.html": page(
            "Fernlea Physio", f"Physio in {c}", SWAP_TEMPLATE.format(c=c)
        )
        for c in CITIES
    }


# --- corpus (b): enriched location pages with a shared frame -------------

FRAME = """
<h1>Fernlea Physio {name}</h1>
<p class="lede">{intro}</p>
<h2>Meet the team</h2>{team}
<h2>Opening hours</h2><table>{hours}</table>
<h2>Getting here</h2><p>{directions}</p>
<h2>This month at {name}</h2><p>{offer}</p>
<h2>What we treat</h2>
<ul><li>Back and neck pain</li><li>Sports injuries</li><li>Post-surgery rehabilitation</li></ul>
<p>Book online any time, or call the clinic and the front desk will find you a slot.</p>
<h2>Common questions</h2>
<h3>Do I need a referral from my doctor?</h3>
<p>No. You can book directly with us as a self-pay patient. If you are claiming on health
insurance, check with your insurer first because some policies ask for a referral.</p>
<h3>What should I wear to my first appointment?</h3>
<p>Wear loose, comfortable clothing so your physiotherapist can see and move the area being
treated. Shorts are useful for knee, hip and lower back problems.</p>
<h3>How many sessions will I need?</h3>
<p>Most patients need between three and six sessions. Your physiotherapist will agree a plan with
you at the first appointment and review it as you progress.</p>
"""

ENRICHED = [
    {
        "name": "Clifton",
        "intro": "Our Clifton clinic sits above the old pharmacy on Princess Victoria Street, two minutes "
        "from the suspension bridge. Most of our patients here are runners training on the Downs and "
        "students from the university rowing club.",
        "team": [
            (
                "Amara Okafor",
                (
                    "leads the clinic and specialises in running gait analysis; she "
                    "has supported the city half marathon medical tent for six years"
                ),
            ),
            (
                "Tom Hersey",
                (
                    "is a former rugby academy physio who runs our ACL return-to-sport "
                    "programme on Thursday evenings"
                ),
            ),
        ],
        "hours": [("Mon-Thu", "7am-8pm"), ("Fri", "7am-5pm"), ("Sat", "8am-1pm")],
        "directions": "The 8 and 9 buses stop outside. Pay-and-display parking on Regent Street fills "
        "early on match days, so allow extra time. Step-free access is through the side door on "
        "Boyces Avenue.",
        "offer": "Free gait screening on the Downs every Saturday in October, before the parkrun, "
        "with a written report emailed the same day.",
    },
    {
        "name": "Bath Riverside",
        "intro": "The Riverside clinic shares a converted mill with a climbing wall, so we see a lot of "
        "finger pulley strains and shoulder problems alongside the usual desk-worker back pain.",
        "team": [
            (
                "Grace Lin",
                (
                    "is our hand and upper-limb specialist and holds a postgraduate "
                    "certificate in hand therapy"
                ),
            ),
            (
                "Dafydd Rees",
                (
                    "runs the hydrotherapy sessions at the leisure centre pool on "
                    "Monday and Wednesday mornings"
                ),
            ),
        ],
        "hours": [("Mon", "9am-6pm"), ("Tue-Fri", "8am-7pm"), ("Sun", "10am-2pm")],
        "directions": "Walk ten minutes along the towpath from the station, or park at the mill car park "
        "and claim three hours free at reception. Cyclists can lock up in the covered rack by the "
        "climbing wall entrance.",
        "offer": "Climbers who show a wall membership card get a discounted finger-injury assessment, and "
        "we run a pulley-rehab workshop with the wall coaches on the last Sunday of the month.",
    },
    {
        "name": "Swindon Old Town",
        "intro": "Swindon Old Town is our largest site, with a full rehab gym and an anti-gravity "
        "treadmill. Many patients come to us after knee or hip replacements at the Great Western "
        "Hospital.",
        "team": [
            (
                "Priya Natarajan",
                (
                    "manages our post-operative pathway and liaises directly with the "
                    "orthopaedic consultants at the hospital"
                ),
            ),
            (
                "Kieran Walsh",
                (
                    "is a strength and conditioning coach who designs the gym progressions "
                    "for every joint-replacement patient"
                ),
            ),
            (
                "Hannah Brooke",
                (
                    "treats pelvic health and pregnancy-related pain in a private room on "
                    "the ground floor"
                ),
            ),
        ],
        "hours": [("Mon-Fri", "7am-9pm"), ("Sat-Sun", "9am-3pm")],
        "directions": "We are on Wood Street opposite the market square. The Old Town car park on Devizes "
        "Road is cheapest after four. The number 1 bus from the bus station drops you at the top of "
        "the hill.",
        "offer": "Our twelve-week new-knee class starts on the first Monday of each month, with "
        "small groups of six and a progress test in weeks one, six and twelve.",
    },
    {
        "name": "Gloucester Quays",
        "intro": "At the Quays we treat a lot of shift workers from the docks and the distribution "
        "centres, so we open early and late and keep two emergency slots free every day.",
        "team": [
            (
                "Marek Nowak",
                (
                    "speaks Polish and English and has a background in occupational health "
                    "and manual handling assessments"
                ),
            ),
            (
                "Siobhan Carey",
                (
                    "runs our acupuncture and dry-needling clinic and teaches the "
                    "lunchtime back-care class for local employers"
                ),
            ),
        ],
        "hours": [("Mon-Fri", "6am-10pm"), ("Sat", "7am-12pm")],
        "directions": "Take the footbridge from the outlet centre and turn left at the lightship. There is "
        "a loading bay for drop-offs and blue-badge spaces directly outside the glass doors.",
        "offer": "Employers along the docks can book a free on-site manual-handling talk; staff then get "
        "priority access to our early-morning appointments for a quarter.",
    },
    {
        "name": "Cheltenham Montpellier",
        "intro": "Montpellier is a quieter, appointment-only studio that focuses on older adults, falls "
        "prevention and balance, with a strong link to the local walking-for-health groups.",
        "team": [
            (
                "Eleanor Fry",
                (
                    "is a consultant physio in older people's care and runs our falls "
                    "clinic with a balance plate and timed tests"
                ),
            ),
            (
                "Joseph Adeyemi",
                (
                    "leads the chair-based strength classes at the community centre on "
                    "Tuesday afternoons"
                ),
            ),
        ],
        "hours": [("Tue-Thu", "9am-5pm"), ("Fri", "9am-1pm")],
        "directions": "We are in the arcade behind the gardens, ground floor with a ramp. A short-stay "
        "car park is opposite the rotunda, and the D bus stops on the promenade.",
        "offer": "Bring a friend to the Wednesday balance class free for their first two sessions; "
        "carers can sit in and learn the home exercises too.",
    },
]


def enriched() -> dict[str, str]:
    out = {}
    for e in ENRICHED:
        team = "".join(f"<h3>{n}</h3><p>{n.split()[0]} {bio}.</p>" for n, bio in e["team"])
        hours = "".join(f"<tr><th>{d}</th><td>{h}</td></tr>" for d, h in e["hours"])
        body = FRAME.format(
            name=e["name"],
            intro=e["intro"],
            team=team,
            hours=hours,
            directions=e["directions"],
            offer=e["offer"],
        )
        out[f"{e['name'].lower().replace(' ', '-')}.html"] = page(
            "Fernlea Physio", f"Fernlea Physio {e['name']}", body
        )
    return out


# --- corpus (c): vs pages, shared frame, different tables ----------------

VS_FRAME = """
<h1>Ledgerly vs {c}: which suits a small accounting practice?</h1>
<p>This page compares Ledgerly with {c} for practices of two to twenty staff. We tested both
products with the same sample client set and checked each claim on the vendor's public pages.</p>
<h2>How we compared</h2>
<p>We scored onboarding time, bank feeds, payroll, client portal and price for a ten-client
practice. Where a value is a vendor claim rather than our test, the table says so.</p>
<h2>Side by side</h2>
<table><tr><th>Feature</th><th>Ledgerly</th><th>{c}</th></tr>{rows}</table>
<h2>Where {c} is the better choice</h2><p>{better}</p>
<h2>Our verdict</h2><p>{verdict}</p>
<p>Start a free trial or book a demo with our team.</p>
"""
VS = [
    {
        "c": "Tallybook",
        "rows": [
            (
                "UK bank feeds",
                "38 banks via open banking",
                "Major high-street banks only",
            ),
            ("Making Tax Digital VAT", "Built in", "Built in"),
            (
                "Payroll",
                "Add-on, per employee",
                "Not offered; integrates with external payroll",
            ),
            ("Client portal", "Document requests and e-signature", "Read-only reports"),
            ("Onboarding time in our test", "45 minutes", "2 hours 10 minutes"),
        ],
        "better": "Tallybook has a stronger mobile receipt scanner and its offline mode worked on a "
        "train with no signal, which Ledgerly does not support.",
        "verdict": "Choose Ledgerly if client document chasing eats your week; choose Tallybook if "
        "your clients mostly self-serve from a phone.",
    },
    {
        "c": "Countwise",
        "rows": [
            (
                "Practice management",
                "Jobs, deadlines and time tracking",
                "Deadlines only",
            ),
            (
                "Multi-currency",
                "Twelve currencies",
                "Over 160 currencies with daily revaluation",
            ),
            ("Audit trail export", "CSV", "CSV and PDF with signatures"),
            (
                "Support hours",
                "UK office hours, phone and chat",
                "Twenty-four hour chat",
            ),
        ],
        "better": "Countwise is clearly ahead for clients who trade abroad: its revaluation journals "
        "ran automatically in our test while Ledgerly needed manual entries.",
        "verdict": "Practices with exporting clients should shortlist Countwise. Purely domestic "
        "practices will find Ledgerly's job tracking saves more time.",
    },
    {
        "c": "Sumly",
        "rows": [
            (
                "Starting price for ten clients",
                "Flat practice plan",
                "Per-client pricing",
            ),
            ("Free tier", "None, thirty-day trial", "Free for one client"),
            ("API access", "Public REST API", "Partner programme only"),
            ("Data residency", "UK hosted", "EU hosted"),
            ("Accountant training", "Live onboarding call", "Video library"),
        ],
        "better": "Sumly is cheaper for a sole practitioner with two or three clients and its free "
        "tier is genuinely usable for a first client.",
        "verdict": "Sumly wins on price below five clients. Above that, Ledgerly's flat plan and API "
        "become the better deal for growing practices.",
    },
]


def vs_pages() -> dict[str, str]:
    out = {}
    for v in VS:
        rows = "".join(f"<tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>" for a, b, c in v["rows"])
        out[f"ledgerly-vs-{v['c'].lower()}.html"] = page(
            "Ledgerly",
            f"Ledgerly vs {v['c']}",
            VS_FRAME.format(c=v["c"], rows=rows, better=v["better"], verdict=v["verdict"]),
        )
    return out


# --- local-chain fixture: render the location template statically --------


def render_local_chain() -> dict[str, str]:
    """Renders app/locations/[slug]/page.tsx for each premises clinic in cities.json."""
    base = FIXTURES / "local-chain"
    tsx = (base / "app" / "locations" / "[slug]" / "page.tsx").read_text()
    layout = (base / "app" / "layout.tsx").read_text()
    jsx = tsx[tsx.rindex("return (") + len("return (") : tsx.rindex(");")]
    jsx = re.sub(r"<script\b.*?/>", "", jsx, flags=re.DOTALL)
    jsx = re.sub(r"<iframe\b.*?/>", "", jsx, flags=re.DOTALL)
    jsx = jsx.replace('{" "}', " ")
    header = re.search(r"<header>.*?</header>", layout, flags=re.DOTALL).group(0)
    out = {}
    for c in json.loads((base / "data" / "cities.json").read_text()):
        if not c["hasPremises"]:
            continue
        body = re.sub(r"\{city\}", c["city"], jsx)
        assert "{" not in body, f"unrendered JSX expression: {body}"
        out[f"{c['slug']}.html"] = (
            f"<!doctype html><html lang='en-GB'><head><title>Dentist in {c['city']}</title></head>"
            f"<body>{header}{body}</body></html>"
        )
    return out


# --- helpers -------------------------------------------------------------


def write(tmp: Path, name: str, files: dict[str, str]) -> Path:
    d = tmp / name
    d.mkdir()
    for f, html in files.items():
        (d / f).write_text(html)
    return d


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def summary_and_pairs(d: Path, *extra: str) -> tuple[int, dict, list[float]]:
    p = run("--files", str(d / "*.html"), "--json", "--threshold", "0", *extra)
    lines = [json.loads(x) for x in p.stdout.splitlines()]
    return p.returncode, lines[0], [x["jaccard"] for x in lines if x["type"] == "pair"]


def corpus_scores(files: dict[str, str], auto: bool = True) -> list[float]:
    r = footprint.analyse(list(files.items()), [], auto=auto)
    return [p["jaccard"] for p in r["pairs"]]


# --- calibration ---------------------------------------------------------


def test_calibration_city_swap_scores_at_least_0_9():
    s = corpus_scores(city_swap())
    assert len(s) == 10
    assert min(s) >= 0.9, s


def test_calibration_enriched_scores_at_most_0_5():
    s = corpus_scores(enriched())
    assert len(s) == 10
    assert max(s) <= 0.5, s


def test_calibration_vs_pages_with_own_tables_stay_under_default():
    s = corpus_scores(vs_pages())
    assert len(s) == 3
    assert max(s) < footprint.DEFAULT_THRESHOLD, s


def test_default_threshold_separates_calibration_sets():
    swap_min = min(corpus_scores(city_swap()))
    rich_max = max(corpus_scores(enriched()) + corpus_scores(vs_pages()))
    assert rich_max < footprint.DEFAULT_THRESHOLD <= swap_min


def test_calibration_report(capsys):
    rows = {
        "city-swap (auto strip)": corpus_scores(city_swap()),
        "city-swap (no strip)": corpus_scores(city_swap(), auto=False),
        "enriched (auto strip)": corpus_scores(enriched()),
        "enriched (no strip)": corpus_scores(enriched(), auto=False),
        "vs (auto strip)": corpus_scores(vs_pages()),
        "vs (no strip)": corpus_scores(vs_pages(), auto=False),
        "local-chain fixture (auto strip)": corpus_scores(render_local_chain()),
    }
    with capsys.disabled():
        print("\ncalibration: min / median / max pair Jaccard")
        for k, s in rows.items():
            s = sorted(s)
            print(f"  {k:34} {s[0]:.3f} / {s[len(s) // 2]:.3f} / {s[-1]:.3f}  ({len(s)} pairs)")


# --- local-chain fixture -------------------------------------------------


def test_local_chain_template_is_a_footprint(tmp_path):
    d = write(tmp_path, "lc", render_local_chain())
    _, summary, pairs = summary_and_pairs(d)
    assert summary["pages"] == 12
    assert len(pairs) == 66
    assert min(pairs) >= 0.9
    p = run("--files", str(d / "*.html"))
    assert p.returncode == 1
    assert "PAIRS >= 0.60: 66 of 66" in p.stdout


# --- CLI contract --------------------------------------------------------


def test_city_swap_exits_1_and_prints_threshold(tmp_path):
    d = write(tmp_path, "swap", city_swap())
    p = run("--files", str(d / "*.html"))
    assert p.returncode == 1, p.stdout + p.stderr
    assert f"threshold {footprint.DEFAULT_THRESHOLD:.2f}" in p.stdout
    assert "UNIQUE SHARE < 20%: 5 of 5" in p.stdout
    assert "VERDICT: template footprint" in p.stdout


def test_enriched_exits_0(tmp_path):
    d = write(tmp_path, "rich", enriched())
    p = run("--files", str(d / "*.html"))
    assert p.returncode == 0, p.stdout
    assert "PAIRS >= 0.60: 0 of 10" in p.stdout


def test_strip_tokens_file_does_the_work_without_auto(tmp_path):
    d = write(tmp_path, "swap", city_swap())
    _, _, raw = summary_and_pairs(d, "--no-auto-strip")
    assert max(raw) < 0.6, "names left in should hide the template"
    tok = tmp_path / "tokens.txt"
    tok.write_text("# swapped cities\n" + "\n".join(CITIES) + "\n")
    _, summary, stripped = summary_and_pairs(d, "--no-auto-strip", "--strip-tokens", str(tok))
    assert min(stripped) >= 0.9
    assert summary["strip_phrases"] == len(CITIES)


def test_multiword_strip_phrase_is_removed_whole():
    words = ["Our", "Cheltenham", "Spa", "clinic", "and", "Cheltenham", "town"]
    out = footprint.strip_phrases(words, [["cheltenham", "spa"]])
    assert out == ["Our", "clinic", "and", "Cheltenham", "town"]


def test_digits_and_chrome_are_ignored(tmp_path):
    a = page(
        "X",
        "a",
        "<p>Call 0117 496 0000 or visit unit 4 for your assessment today please.</p>",
    )
    b = page(
        "X",
        "b",
        "<p>Call 0161 496 0999 or visit unit 12 for your assessment today please.</p>",
    )
    r = footprint.analyse([("a", a), ("b", b)], [], auto=True)
    assert r["pairs"][0]["jaccard"] == 1.0
    words = footprint.tokens(footprint.extract_blocks(a))
    assert "cookies" not in [w.lower() for w in words]  # outside <main>
    assert "Privacy" not in words
    assert "Locations" not in words


def test_cross_page_boilerplate_without_semantic_tags():
    menu = (
        '<div class="top-menu"><a href="/a">Home</a> <a href="/b">Prices</a> '
        '<a href="/c">Contact us today</a></div>'
    )
    pages = [
        (
            "p1",
            f"<body>{menu}<div>Alpha bravo charlie delta echo foxtrot golf hotel.</div></body>",
        ),
        (
            "p2",
            f"<body>{menu}<div>India juliet kilo lima mike november oscar papa.</div></body>",
        ),
        (
            "p3",
            f"<body>{menu}<div>Quebec romeo sierra tango uniform victor whiskey.</div></body>",
        ),
    ]
    r = footprint.analyse(pages, [], auto=False)
    assert r["boilerplate_blocks"] == 3
    assert all(p["jaccard"] == 0 for p in r["pairs"])


def test_repeated_template_prose_is_not_treated_as_boilerplate():
    body = "<div>Our friendly team offers check-ups, hygiene and emergency care for families.</div>"
    r = footprint.analyse(
        [("a", f"<body>{body}</body>"), ("b", f"<body>{body}</body>")], [], auto=False
    )
    assert r["boilerplate_blocks"] == 0
    assert r["pairs"][0]["jaccard"] == 1.0


def test_fewer_than_two_pages_exits_2(tmp_path):
    d = write(tmp_path, "one", {"only.html": page("X", "x", "<p>one page only here</p>")})
    p = run("--files", str(d / "*.html"))
    assert p.returncode == 2
    assert "SKIPPED" in p.stdout


def test_js_shell_pages_have_no_text_and_exit_2(tmp_path):
    shell = (FIXTURES / "spa-shell" / "index.html").read_text()
    d = write(tmp_path, "spa", {"a.html": shell, "b.html": shell})
    p = run("--files", str(d / "*.html"))
    assert p.returncode == 2
    assert "NO_TEXT 2 page(s)" in p.stdout
    assert "SKIPPED" in p.stdout


def test_non_url_positional_is_usage_error():
    p = run("not-a-url.html")
    assert p.returncode == 2
    assert "--files" in p.stderr


def test_json_lines_shape(tmp_path):
    d = write(tmp_path, "swap", city_swap())
    p = run("--files", str(d / "*.html"), "--json")
    lines = [json.loads(x) for x in p.stdout.splitlines()]
    assert lines[0]["type"] == "summary"
    assert lines[0]["exit"] == 1 == p.returncode
    assert lines[0]["threshold"] == footprint.DEFAULT_THRESHOLD
    assert sum(x["type"] == "page" for x in lines) == 5
    assert sum(x["type"] == "pair" for x in lines) == 10


def test_stdout_is_bounded(tmp_path):
    files = {
        f"p{i}.html": page("X", "t", SWAP_TEMPLATE.format(c=f"Town{chr(65 + i)}"))
        for i in range(20)
    }
    d = write(tmp_path, "many", files)
    p = run("--files", str(d / "*.html"))
    assert p.returncode == 1
    assert len(p.stdout.splitlines()) <= 2 * footprint.MAX_ROWS + 12
    assert "more (use --json)" in p.stdout


@pytest.fixture
def server(tmp_path):
    d = write(tmp_path, "www", city_swap())
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(d))
    handler.log_message = lambda *a, **k: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def test_fetches_urls(server):
    urls = [f"{server}/{f}" for f in itertools.islice(city_swap(), 3)]
    p = run(*urls)
    assert p.returncode == 1, p.stdout + p.stderr
    assert "/bristol.html" in p.stdout


def test_fetch_failure_leaves_too_few_pages(server):
    p = run(f"{server}/bristol.html", f"{server}/missing.html")
    assert p.returncode == 2
    assert "FETCH_FAILED" in p.stderr
