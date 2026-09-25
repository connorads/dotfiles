#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow", "playwright"]
# ///
"""canvas-film pipeline: voice, sound, timeline, mix, build, review, render.

Every command takes the project dir (holding film.json) first. Run
`film.py <command> -h` for arguments. Needs ffmpeg on PATH; audio
commands need ELEVENLABS_API_KEY.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
import wave
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
R = 48000
API = "https://api.elevenlabs.io/v1"


def die(msg: str) -> None:
    print(f"film: {msg}", file=sys.stderr)
    sys.exit(1)


def cfg(d: Path) -> dict:
    f = d / "film.json"
    if not f.exists():
        die(f"no film.json in {d} (run: film.py init {d})")
    return json.loads(f.read_text())


def need(tool: str) -> None:
    if not shutil.which(tool):
        die(f"{tool} not found on PATH")


# ------------------------------------------------------------------ ElevenLabs
def el(path: str, body: dict | None = None, form: dict | None = None, timeout: int = 400) -> bytes:
    key = os.environ.get("ELEVENLABS_API_KEY") or die("ELEVENLABS_API_KEY is not set")
    headers = {"xi-api-key": key}
    if form is not None:
        b = "----" + uuid.uuid4().hex
        parts = []
        for k, v in form.items():
            if k == "file":
                parts.append(
                    f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'.encode()
                    + v
                    + b"\r\n"
                )
            else:
                parts.append(
                    f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
                )
        data = b"".join(parts) + f"--{b}--\r\n".encode()
        headers["Content-Type"] = "multipart/form-data; boundary=" + b
    else:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers)
    try:
        return urllib.request.urlopen(req, timeout=timeout).read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}") from None


def stt_words(audio: bytes) -> dict:
    r = json.loads(
        el(
            "/speech-to-text",
            form={
                "model_id": "scribe_v2",
                "timestamps_granularity": "word",
                "tag_audio_events": "true",
                "file": audio,
            },
            timeout=300,
        )
    )
    return r


def pool(fn, items, workers: int):
    with cf.ThreadPoolExecutor(workers) as ex:
        for res in ex.map(fn, items):
            print(*res, flush=True)


def cmd_tts(a):
    d = Path(a.dir)
    c = cfg(d)
    out = d / "audio/vo"
    out.mkdir(parents=True, exist_ok=True)
    lines = [ln for ln in c["lines"] if not a.ids or ln["id"] in a.ids]
    st = c.get("voice_settings", {"stability": 0.5, "similarity_boost": 0.8})

    def go(ln):
        vid = c["voices"].get(ln["speaker"]) or die(f"no voice for speaker {ln['speaker']}")
        body = {
            "text": ln["text"],
            "model_id": c.get("tts_model", "eleven_v3"),
            "voice_settings": st,
            "apply_text_normalization": "on",
        }
        try:
            r = json.loads(
                el(
                    f"/text-to-speech/{vid}/with-timestamps?output_format=mp3_44100_192",
                    body,
                )
            )
            mp3 = base64.b64decode(r["audio_base64"])
            (out / f"{ln['id']}.mp3").write_bytes(mp3)
            s = stt_words(mp3)
            words = [w for w in s["words"] if w["type"] != "spacing"]
            (out / f"{ln['id']}.stt.json").write_text(json.dumps(words))
            return ln["id"], f"{dur(out / (ln['id'] + '.mp3')):.2f}s", "|", s["text"]
        except RuntimeError as e:
            return ln["id"], "ERR", str(e)

    pool(go, lines, 2)


def cmd_sfx(a):
    d = Path(a.dir)
    c = cfg(d)
    out = d / "audio/sfx"
    out.mkdir(parents=True, exist_ok=True)

    def go(k):
        s = c["sfx"][k]
        body = {
            "text": s["prompt"],
            "duration_seconds": s.get("dur"),
            "prompt_influence": s.get("influence", 0.6),
            "model_id": "eleven_text_to_sound_v2",
        }
        try:
            (out / f"{k}.mp3").write_bytes(
                el("/sound-generation?output_format=mp3_44100_128", body)
            )
            return k, "ok"
        except RuntimeError as e:
            return k, "ERR", str(e)

    pool(go, [k for k in c["sfx"] if not a.names or k in a.names], 2)


def cmd_music(a):
    d = Path(a.dir)
    c = cfg(d)
    out = d / "audio/music"
    out.mkdir(parents=True, exist_ok=True)

    def go(k):
        m = c["music"][k]
        body = {
            "prompt": m["prompt"],
            "music_length_ms": m["ms"],
            "model_id": "music_v2",
            "force_instrumental": True,
        }
        try:
            (out / f"{k}.mp3").write_bytes(el("/music?output_format=mp3_48000_192", body))
            return (
                k,
                f"{dur(out / (k + '.mp3')):.2f}s",
                "energy/0.5s:",
                energy(out / f"{k}.mp3"),
            )
        except RuntimeError as e:
            return k, "ERR", str(e)

    # the account caps concurrent requests; music is slow, so two at a time
    pool(go, [k for k in c["music"] if not a.names or k in a.names], 2)


def cmd_stt(a):
    r = stt_words(Path(a.file).read_bytes())
    print(r["text"])
    words = [w for w in r["words"] if w["type"] == "word"]
    for q in a.find or []:
        print(q, [round(w["start"], 2) for w in words if q.lower() in w["text"].lower()])


# ------------------------------------------------------------------ audio utils
def dur(p: Path) -> float:
    return float(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(p),
            ],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
        or 0
    )


def load(p: Path, ch: int = 2, tempo: float = 1.0):
    import numpy as np

    af = ["-af", f"atempo={tempo}"] if tempo != 1.0 else []
    raw = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(p),
            *af,
            "-ac",
            str(ch),
            "-ar",
            str(R),
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).copy()


def energy(p: Path) -> str:
    import numpy as np

    x = load(p, 1)[:, 0]
    n = R // 2
    return " ".join(
        str(int(100 * np.sqrt(np.mean(x[i : i + n] ** 2)))) for i in range(0, len(x) - n, n)
    )


def wav(p: Path, x, ch: int):
    import numpy as np

    p.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(p), "wb") as f:
        f.setnchannels(ch)
        f.setsampwidth(2)
        f.setframerate(R)
        f.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def norm(s: str) -> str:
    return re.sub(r"[^\w']", "", s.lower())


# ------------------------------------------------------------------ timeline
def tighten(d: Path, line: dict, tempo: float):
    """Trim edges, shorten named pauses, optionally start at a word. Returns audio, words."""
    import numpy as np

    a = load(d / f"audio/vo/{line['id']}.mp3", 1, tempo)[:, 0]
    ws = [dict(w) for w in json.loads((d / f"audio/vo/{line['id']}.stt.json").read_text())]
    for w in ws:
        w["start"] /= tempo
        w["end"] /= tempo
    ws = [w for w in ws if w["type"] != "spacing"]
    cuts = {norm(k): v for k, v in line.get("cuts", {}).items()}
    segs = []
    for i in range(1, len(ws)):
        g = ws[i]["start"] - ws[i - 1]["end"]
        t = cuts.get(norm(ws[i - 1]["text"]))
        if t is not None and g > t:
            mid = (ws[i - 1]["end"] + ws[i]["start"]) / 2
            rm = g - t
            segs.append((mid - rm / 2, mid + rm / 2))
    if line.get("skip"):
        k = next(
            (i for i, w in enumerate(ws) if norm(w["text"]).startswith(norm(line["skip"]))),
            None,
        )
        if k is None:
            die(f"{line['id']}: skip word {line['skip']!r} not in transcript")
        ws = ws[k:]
        segs = [s for s in segs if s[0] > ws[0]["start"]]
    st = max(0, ws[0]["start"] - 0.06)
    en = min(len(a) / R, ws[-1]["end"] + 0.22)
    parts, pos = [], st
    for cs, ce in segs:
        parts.append(a[int(pos * R) : int(cs * R)])
        pos = ce
    parts.append(a[int(pos * R) : int(en * R)])
    f = int(0.008 * R)
    y = parts[0]
    for s in parts[1:]:
        if len(y) > f and len(s) > f:
            r = np.linspace(0, 1, f, dtype=np.float32)
            y = np.concatenate([y[:-f], y[-f:] * (1 - r) + s[:f] * r, s[f:]])
        else:
            y = np.concatenate([y, s])

    def mapt(t):
        off = st
        for cs, ce in segs:
            if t >= ce:
                off += ce - cs
            elif t > cs:
                return cs - off
        return t - off

    n = int(0.05 * R)
    y[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
    return y, [
        {
            "w": w["text"],
            "s": round(mapt(w["start"]), 3),
            "e": round(mapt(w["end"]), 3),
            "type": w["type"],
        }
        for w in ws
    ]


def cmd_timeline(a):
    import numpy as np

    d = Path(a.dir)
    c = cfg(d)
    tempos = c.get("tempo", {})
    clips, prev_end = [], 0.0
    for i, line in enumerate(c["lines"]):
        y, ws = tighten(
            d,
            line,
            line.get("tempo", tempos.get(line["speaker"], tempos.get("*", 1.0))),
        )
        gap = line.get("gap", 0.25)
        start = c.get("start", 1.0) if i == 0 else prev_end + gap
        du = len(y) / R
        clips.append(
            {
                "id": line["id"],
                "speaker": line["speaker"],
                "start": round(start, 3),
                "dur": round(du, 3),
                "text": line["text"],
                "words": [
                    {
                        "w": w["w"],
                        "s": round(start + w["s"], 3),
                        "e": round(start + w["e"], 3),
                    }
                    for w in ws
                    if w["type"] == "word"
                ],
                "_y": y,
            }
        )
        prev_end = max(prev_end, start + du) if gap < 0 else start + du
    end = prev_end + c.get("tail", 2.0)
    fps = 60
    mix = np.zeros(int(end * R) + R, np.float32)
    env = {}
    for cl in clips:
        s = int(cl["start"] * R)
        y = cl.pop("_y")
        mix[s : s + len(y)] += y
        e = env.setdefault(cl["speaker"], np.zeros(int(end * fps) + fps, np.float32))
        hop = R // fps
        for k in range(len(y) // hop):
            idx = int(cl["start"] * fps) + k
            if idx < len(e):
                e[idx] = max(e[idx], float(np.sqrt(np.mean(y[k * hop : (k + 1) * hop] ** 2))))
    wav(d / "mix/vo.wav", mix[: int(end * R)], 1)
    tl = {
        "duration": round(end, 3),
        "envFps": fps,
        "clips": clips,
        "env": {
            k: [round(min(1, float(v) * 6), 2) for v in arr[: int(end * fps)]]
            for k, arr in env.items()
        },
    }
    (d / "build").mkdir(exist_ok=True)
    (d / "build/timeline.json").write_text(json.dumps(tl, separators=(",", ":")))
    for cl in clips:
        print(
            f"{cl['id']:5} {cl['speaker']:10} {cl['start']:6.2f} -> {cl['start'] + cl['dur']:6.2f}  {cl['text'][:56]}"
        )
    print(f"END {end:.2f}s")


def resolve(ref, clips) -> float:
    """Number, or "<line>", "<line>$" (end), "<line>:<word>" (word start), each with optional +/-offset."""
    if isinstance(ref, (int, float)):
        return float(ref)
    m = re.fullmatch(r"([\w-]+)(\$|:([^+\-]+))?([+-][\d.]+)?", ref.strip())
    if not m:
        die(f"bad time ref {ref!r}")
    cl = next((c for c in clips if c["id"] == m[1]), None) or die(
        f"time ref {ref!r}: no line {m[1]}"
    )
    if m[2] == "$":
        t = cl["start"] + cl["dur"]
    elif m[3]:
        w = next((w for w in cl["words"] if norm(w["w"]).startswith(norm(m[3]))), None) or die(
            f"time ref {ref!r}: word not found"
        )
        t = w["s"]
    else:
        t = cl["start"]
    return t + float(m[4] or 0)


def cmd_mix(a):
    import numpy as np

    d = Path(a.dir)
    c = cfg(d)
    mx = c.get("mix", {})
    tl = json.loads((d / "build/timeline.json").read_text())
    clips = tl["clips"]
    end = tl["duration"]
    N = int(end * R)

    def at(r):
        return resolve(r, clips)

    def place(buf, x, t, g=1.0, fin=0.0, fout=0.02, until=None):
        s = int(t * R)
        x = x * g
        if until is not None:
            x = x[: max(0, int((until - t) * R))]
        if fin > 0:
            n = min(len(x), int(fin * R))
            x[:n] *= np.linspace(0, 1, n)[:, None]
        if fout > 0:
            n = min(len(x), int(fout * R))
            x[len(x) - n :] *= np.linspace(1, 0, n)[:, None]
        e = min(N, s + len(x))
        buf[s:e] += x[: max(0, e - s)]

    vo = load(d / "mix/vo.wav", 1)[:, 0]
    vo = np.pad(vo, (0, max(0, N - len(vo))))[:N]
    for b in mx.get("bleep", []):
        cl = next(x for x in clips if x["id"] == b["line"])
        w = next((w for w in cl["words"] if norm(w["w"]).startswith(norm(b["word"]))), None) or die(
            f"bleep word {b['word']!r} not in {b['line']}"
        )
        i0, i1 = int((w["s"] - 0.03) * R), int((w["e"] + 0.02) * R)
        f = int(0.004 * R)
        tone = 0.22 * np.sin(2 * np.pi * b.get("freq", 1000) * np.arange(i1 - i0) / R).astype(
            np.float32
        )
        tone[:f] *= np.linspace(0, 1, f)
        tone[-f:] *= np.linspace(1, 0, f)
        vo[i0:i1] = tone
    k = int(0.12 * R)
    act = np.clip(np.convolve(np.abs(vo), np.ones(k) / k, "same") / 0.02, 0, 1)
    k = int(0.25 * R)
    act = np.convolve(act, np.ones(k) / k, "same")
    mus = np.zeros((N, 2), np.float32)
    for m in mx.get("music", []):
        place(
            mus,
            load(d / f"audio/music/{m['name']}.mp3"),
            at(m["at"]),
            m.get("gain", 0.55),
            m.get("fin", 0.05),
            m.get("fout", 0.05),
            at(m["until"]) if "until" in m else None,
        )
    mus *= (1 - mx.get("duck", 0.55) * act)[:, None]
    sfx = np.zeros((N, 2), np.float32)
    cache = {}
    for s in mx.get("sfx", []):
        s = {"name": s[0], "at": s[1], "gain": s[2]} if isinstance(s, list) else s
        x = cache.setdefault(s["name"], load(d / f"audio/sfx/{s['name']}.mp3"))
        place(
            sfx,
            x,
            at(s["at"]),
            s["gain"],
            s.get("fin", 0),
            s.get("fout", 0.02),
            at(s["until"]) if "until" in s else None,
        )
    sfx *= (1 - 0.25 * act)[:, None]
    out = (mus + sfx + vo[:, None]) * 0.8
    print(f"peak {float(np.abs(out).max()):.2f} (keep under 1.0)")
    wav(d / "mix/pre.wav", out, 2)
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(d / "mix/pre.wav"),
            "-af",
            f"loudnorm=I={mx.get('lufs', -15)}:TP=-1.5:LRA=11",
            "-ar",
            str(R),
            str(d / "mix/soundtrack.wav"),
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(d / "mix/soundtrack.wav"),
            "-b:a",
            "192k",
            str(d / "mix/soundtrack.mp3"),
        ],
        check=True,
    )
    print("wrote mix/soundtrack.wav and .mp3")


# ------------------------------------------------------------------ build & browser
MIME = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def cmd_build(a):
    d = Path(a.dir)
    c = cfg(d)

    def uri(p: Path, m: str) -> str:
        return f"data:{m};base64," + base64.b64encode(p.read_bytes()).decode()

    A = {}
    for p in sorted((d / "assets/img").glob("*")):
        if p.suffix in MIME:
            A["img_" + p.stem] = uri(p, MIME[p.suffix])
    for p in sorted((d / "assets/fonts").glob("*.woff2")):
        A["font_" + p.stem] = uri(p, "font/woff2")
    snd = d / "mix/soundtrack.mp3"
    if snd.exists():
        A["audio"] = uri(snd, "audio/mpeg")
    tl = (d / "build/timeline.json").read_text()
    src = (d / "src/engine.html").read_text()
    for name in ("style.js", "scenes.js"):
        src = src.replace(f"/*INLINE:{name}*/", (d / "src" / name).read_text())
    src = src.replace("/*ASSETS*/{}", json.dumps(A)).replace("/*TIMELINE*/{}", tl)
    i = src.index('<div id="stage">')
    html = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + src[:i]
        + "</head>\n<body>\n"
        + src[i:]
        + "\n</body>\n</html>\n"
    )
    out = d / "dist" / f"{c['name']}.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print(f"wrote {out.relative_to(d)} ({len(html) / 1e6:.1f} MB)")


def chrome_path() -> str | None:
    for exe in (
        os.environ.get("FILM_CHROME"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
    ):
        if exe and Path(exe).exists():
            return exe
    return None


async def browser(p):
    from playwright.async_api import Error as PlaywrightError

    args = ["--autoplay-policy=no-user-gesture-required"]
    try:
        return await p.chromium.launch(args=args)
    except PlaywrightError:
        exe = chrome_path() or die(
            "no Chromium: run `uv run --with playwright playwright install chromium` or set FILM_CHROME"
        )
        return await p.chromium.launch(executable_path=exe, args=args)


async def page(p, d: Path, export=True):
    b = await browser(p)
    pg = await b.new_page(viewport={"width": 1920, "height": 1080})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    if export:
        await pg.add_init_script("window.__EXPORT=true")
    await pg.goto((d / "dist" / f"{cfg(d)['name']}.html").resolve().as_uri())
    await pg.evaluate("window.__ready")
    return b, pg, errs


FRAME = "(renderAt({t}), document.getElementById('c').toDataURL('image/jpeg',{q}))"


def grid(paths, out: Path, cols: int, w: int):
    from PIL import Image

    ims = [Image.open(p) for p in paths]
    h = int(w * 9 / 16)
    sheet = Image.new("RGB", (cols * w, -(-len(ims) // cols) * h))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
    sheet.save(out, quality=85)
    print(f"sheet: {out}")


def cmd_snap(a):
    import asyncio

    from playwright.async_api import async_playwright

    d = Path(a.dir)
    out = d / "build/snaps"
    out.mkdir(parents=True, exist_ok=True)
    paths = []

    async def run():
        async with async_playwright() as p:
            b, pg, errs = await page(p, d)
            for t in a.times:
                data = await pg.evaluate(FRAME.format(t=float(t), q=0.88))
                f = out / f"s_{float(t):06.2f}.jpg"
                f.write_bytes(base64.b64decode(data.split(",")[1]))
                paths.append(f)
            print("page errors:", errs or "none")
            await b.close()

    asyncio.run(run())
    grid(paths, out / "sheet.jpg", 2, 960)


def cmd_render(a):
    import asyncio

    from playwright.async_api import async_playwright

    need("ffmpeg")
    d = Path(a.dir)
    c = cfg(d)
    tl = json.loads((d / "build/timeline.json").read_text())
    n = int(tl["duration"] * a.fps)
    master = d / "dist" / f"{c['name']}.mp4"
    ff = subprocess.Popen(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "image2pipe",
            "-framerate",
            str(a.fps),
            "-c:v",
            "mjpeg",
            "-i",
            "-",
            "-i",
            str(d / "mix/soundtrack.wav"),
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "19",
            "-pix_fmt",
            "yuv420p",
            "-tune",
            "animation",
            "-c:a",
            "aac",
            "-b:a",
            "256k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(master),
        ],
        stdin=subprocess.PIPE,
    )

    async def run():
        async with async_playwright() as p:
            b, pg, errs = await page(p, d)
            for i in range(n):
                data = await pg.evaluate(FRAME.format(t=i / a.fps, q=0.96))
                ff.stdin.write(base64.b64decode(data.split(",")[1]))
                if i % (a.fps * 10) == 0:
                    print(f"{i}/{n}", flush=True)
            if errs:
                print("page errors:", errs)
            await b.close()

    asyncio.run(run())
    ff.stdin.close()
    ff.wait()
    share = d / "dist" / f"{c['name']}-share.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(master),
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-b:v",
            "3800k",
            "-maxrate",
            "5000k",
            "-bufsize",
            "8000k",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(share),
        ],
        check=True,
    )
    for f in (master, share):
        print(f"{f.relative_to(d)} {f.stat().st_size / 1e6:.0f} MB {dur(f):.2f}s")


def cmd_sheet(a):
    need("ffmpeg")
    v = Path(a.video)
    tmp = v.parent / f".sheet-{v.stem}"
    tmp.mkdir(exist_ok=True)
    for f in tmp.glob("*.jpg"):
        f.unlink()
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(v),
            "-vf",
            f"fps=1/{a.every},scale=384:216",
            str(tmp / "f_%03d.jpg"),
        ],
        check=True,
    )
    grid(sorted(tmp.glob("f_*.jpg")), v.with_suffix(".sheet.jpg"), 6, 384)
    shutil.rmtree(tmp)


def cmd_playtest(a):
    import asyncio

    from playwright.async_api import async_playwright

    async def run():
        async with async_playwright() as p:
            b, pg, errs = await page(p, Path(a.dir), export=False)
            await pg.wait_for_selector("#play:not([hidden])", timeout=20000)
            await pg.click("#play")
            await pg.wait_for_timeout(2500)
            t, paused = await pg.evaluate("[audio.currentTime, audio.paused]")
            fps = await pg.evaluate(
                "new Promise(r=>{let n=0,t0=performance.now();(function f(){n++;performance.now()-t0<2000?requestAnimationFrame(f):r(n/2)})()})"
            )
            print(
                f"audio.currentTime={t:.2f} paused={paused} raf_fps={fps:.0f} errors={errs or 'none'}"
            )
            await b.close()

    asyncio.run(run())


# ------------------------------------------------------------------ project setup
def cmd_init(a):
    d = Path(a.dir)
    style = SKILL / "assets" / f"style-{a.style}.js"
    if not style.exists():
        die(
            f"no style {a.style!r}; have: "
            + ", ".join(p.stem[6:] for p in (SKILL / "assets").glob("style-*.js"))
        )
    if (d / "film.json").exists():
        die(f"{d}/film.json exists; not overwriting")
    for sub in (
        "src",
        "assets/img",
        "assets/fonts",
        "audio/vo",
        "audio/sfx",
        "audio/music",
        "mix",
        "build",
        "dist",
    ):
        (d / sub).mkdir(parents=True, exist_ok=True)
    shutil.copy(SKILL / "assets/engine.html", d / "src/engine.html")
    shutil.copy(style, d / "src/style.js")
    shutil.copy(SKILL / "assets/scenes.example.js", d / "src/scenes.js")
    shutil.copy(SKILL / "assets/film.example.json", d / "film.json")
    print(f"initialised {d} with style {a.style}; edit film.json and src/scenes.js")


def cmd_fonts(a):
    d = Path(a.dir)
    out = d / "assets/fonts"
    out.mkdir(parents=True, exist_ok=True)
    ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    for fam in a.families:
        url = "https://fonts.googleapis.com/css2?family=" + fam.replace(" ", "+")
        css = (
            urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}))
            .read()
            .decode()
        )
        blocks = re.findall(r"/\* ([\w-]+) \*/\s*@font-face\s*{([^}]*)}", css)
        src = next((b for sub, b in blocks if sub == "latin"), blocks[-1][1] if blocks else css)
        woff = re.search(r"url\((https://[^)]+\.woff2)\)", src) or die(f"no woff2 for {fam!r}")
        name = re.sub(r"[^A-Za-z]", "", fam.split(":")[0])
        (out / f"{name}.woff2").write_bytes(urllib.request.urlopen(woff[1]).read())
        print(f"{fam} -> assets/fonts/{name}.woff2 (CSS family {name!r})")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sp = ap.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help, *args):
        p = sp.add_parser(name, help=help)
        p.set_defaults(fn=fn)
        if name not in ("stt", "sheet"):
            p.add_argument("dir")
        for a in args:
            p.add_argument(*a[0], **a[1])

    add("init", cmd_init, "scaffold a project", (["--style"], {"default": "collage"}))
    add(
        "fonts",
        cmd_fonts,
        "download Google Fonts as woff2",
        (["families"], {"nargs": "+"}),
    )
    add("tts", cmd_tts, "voice lines (+ transcript check)", (["ids"], {"nargs": "*"}))
    add("sfx", cmd_sfx, "generate sound effects", (["names"], {"nargs": "*"}))
    add(
        "music",
        cmd_music,
        "generate instrumental music cues",
        (["names"], {"nargs": "*"}),
    )
    add(
        "stt",
        cmd_stt,
        "transcribe any audio/video file",
        (["file"], {}),
        (["--find"], {"nargs": "*"}),
    )
    add(
        "timeline",
        cmd_timeline,
        "tighten lines and lay them out -> build/timeline.json",
    )
    add("mix", cmd_mix, "music + sfx + bleeps + ducking -> mix/soundtrack")
    add("build", cmd_build, "inline everything -> dist/<name>.html")
    add("snap", cmd_snap, "render stills + contact sheet", (["times"], {"nargs": "+"}))
    add(
        "render",
        cmd_render,
        "render master + share MP4",
        (["--fps"], {"type": int, "default": 30}),
    )
    add(
        "sheet",
        cmd_sheet,
        "contact sheet from a video",
        (["video"], {}),
        (["--every"], {"type": float, "default": 1}),
    )
    add("playtest", cmd_playtest, "check live playback in a browser")
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
