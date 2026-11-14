"""Drive the full experiment on the live platform through its API (same path as the Experiments page)."""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://3-0-35-127.sslip.io"
ENV = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\saifr\Documents\Practice Code\Script-Bias-Audit-for-LLM-Judges-Urdu-\.env"
env = dict(line.split("=", 1) for line in open(ENV, encoding="utf-8").read().splitlines() if "=" in line and not line.startswith("#"))
user, pw = env["APP_USERS"].split(",")[0].split(":", 1)
RUN_PW = env["RUN_PASSWORD"]

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path, body=None, run_pw=False):
    headers = {"origin": BASE}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode()
    if run_pw:
        headers["x-run-password"] = RUN_PW
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST" if body is not None else "GET")
    for attempt in range(5):
        try:
            with opener.open(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{path}: HTTP {e.code} {e.read()[:200]!r}")
        except Exception as e:  # transient network
            if attempt == 4:
                raise
            time.sleep(5)


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def runs_by_id():
    return {r["id"]: r for r in call("/api/runs")["runs"]}


def wait(ids, label):
    resumes = {i: 0 for i in ids}
    last = 0
    while True:
        rs = runs_by_id()
        states = {i: rs[i]["status"] for i in ids}
        if time.time() - last > 60:
            log(f"{label}: " + " | ".join(f"#{i} {rs[i]['type']}{'+' + ','.join(k for k, v in rs[i]['config']['flags'].items() if v) if any(rs[i]['config']['flags'].values()) else ''} {rs[i]['done']}/{rs[i]['total']} {rs[i]['status']}" for i in ids))
            last = time.time()
        for i, st in states.items():
            if st in ("failed", "stopped", "interrupted"):
                if resumes[i] >= 3:
                    raise RuntimeError(f"run #{i} {st} after 3 resumes: {rs[i]['error']}")
                resumes[i] += 1
                log(f"run #{i} {st} ({(rs[i]['error'] or '')[:160]}) -> resume {resumes[i]}/3 in 30s")
                time.sleep(30)
                call(f"/api/runs/{i}/start", {}, run_pw=True)
        if all(st == "done" for st in states.values()):
            log(f"{label}: all done")
            return
        time.sleep(15)


def start(body):
    """Reuse an existing run with the same type + flags (unless it failed); otherwise create one."""
    flags = {k: bool((body.get("flags") or {}).get(k)) for k in ("rubric", "transliterate", "panel")}
    for r in sorted(runs_by_id().values(), key=lambda r: -r["id"]):
        if r["type"] == body["type"] and r["config"]["flags"] == flags and r["status"] in ("running", "done", "created", "stopped", "interrupted"):
            log(f"reusing #{r['id']} {body} ({r['status']} {r['done']}/{r['total']})")
            if r["status"] in ("created", "stopped", "interrupted"):
                call(f"/api/runs/{r['id']}/start", {}, run_pw=True)
            return r["id"]
    r = call("/api/runs", body, run_pw=True)
    log(f"started #{r['id']} {body} ({r['calls']} calls, {r['cached']} cached)")
    return r["id"]


call("/api/auth/login", {"username": user, "password": pw})
log("logged in")

# 1. screening gate
sid = start({"type": "screening"})
wait([sid], "screening")
status = {j["id"]: j for j in call("/api/overview")["judges"]}
for j, s in status.items():
    log(f"screening {j}: {s['status']} AUC={s.get('auc')}")
failed = [j for j, s in status.items() if s["status"] != "pass"]
if failed and "--keep-failed" not in sys.argv:
    log(f"STOP: judges failed screening: {failed}")
    sys.exit(3)
if failed:
    log(f"continuing with failed judges flagged (approved by the researcher): {failed}")

# 2. main experiments
ids = [start({"type": "comprehension"}), start({"type": "pointwise"}), start({"type": "pairwise"})]
wait(ids, "main")

# 3. consistency + mitigations
ids = [start({"type": "repeats"}),
       start({"type": "pointwise", "flags": {"rubric": True}}),
       start({"type": "pointwise", "flags": {"transliterate": True}})]
wait(ids, "mitigations")

# 4. panel (reuses the plain pointwise calls from the cache)
pid = start({"type": "pointwise", "flags": {"panel": True}})
wait([pid], "panel")

ov = call("/api/overview")
log(f"ALL DONE. total spend so far ${ov['total_cost_usd']:.4f}, cached calls {ov['total_calls']}")
