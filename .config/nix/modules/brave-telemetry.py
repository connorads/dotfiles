import json
import os
import subprocess
import tempfile
from pathlib import Path

state = Path.home() / "Library/Application Support/BraveSoftware/Brave-Browser/Local State"
if state.exists():
    process = subprocess.run(["/usr/bin/pgrep", "-x", "Brave Browser"], capture_output=True)
    if process.returncode != 1:
        raise SystemExit("Close Brave before applying its telemetry settings.")
    original = state.read_text()
    settings = json.loads(original)
    for section, key in [
        ("brave", "p3a"),
        ("brave", "stats"),
        ("user_experience_metrics", None),
    ]:
        target = settings.setdefault(section, {})
        if key is not None:
            target = target.setdefault(key, {})
        target["enabled" if key == "p3a" else "reporting_enabled"] = False
    rendered = json.dumps(settings, separators=(",", ":"), ensure_ascii=False)
    if original.endswith("\n"):
        rendered += "\n"
    with tempfile.NamedTemporaryFile(mode="w", dir=state.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(rendered)
            output.flush()
            os.chmod(temporary, state.stat().st_mode)
            os.replace(temporary, state)
        finally:
            temporary.unlink(missing_ok=True)
