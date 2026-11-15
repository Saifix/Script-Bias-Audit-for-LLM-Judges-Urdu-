"""Run several experiment rounds on the live platform, with cost and health guards.

    python3 run_rounds.py BASE ENV_PATH
"""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

BASE, ENV = sys.argv[1], sys.argv[2]
BUDGET_STOP = 28.0          # stop before starting anything new past this; the backend hard-caps all spend at $30
MAX_AVG_COMPLETION = 40     # a judge replying with more tokens than this is "thinking" -> too costly, stop
MAX_UNPARSEABLE = 0.10      # share of unreadable replies in screening -> stop

ROUNDS = [
    {"label": "Round 2 · replication", "replicate": 1,
     "judges": ["qwen/qwen3.5-9b", "meta-llama/llama-3.1-8b-instruct", "google/gemma-3-12b-it"]},
    {"label": "Round 3 · medium", "replicate": 0,
     "judges": ["qwen/qwen3-32b", "meta-llama/llama-3.3-70b-instruct", "google/gemma-3-27b-it"]},
    {"label": "Round 4 · large", "replicate": 0,
     "judges": ["qwen/qwen3-235b-a22b-2507", "meta-llama/llama-4-maverick", "google/gemini-2.5-flash"]},
]

env = dict(l.split("=", 1) for l in open(ENV, encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))
user, pw = env["APP_USERS"].split(",")[0].split(":", 1)
RUN_PW = env["RUN_PASSWORD"]
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


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
            with opener.open(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (502, 503, 504) and attempt < 4:   # site restarting: wait and retry
                time.sleep(15)
                continue
            raise RuntimeError(f"{path}: HTTP {e.code} {e.read()[:300]!r}")
        except Exception:
            if attempt == 4:
                raise
            time.sleep(5)


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def stop(msg):
    log("STOP: " + msg)
    sys.exit(3)


def spend():
    return call("/api/overview")["total_cost_usd"]


def runs_by_id():
    return {r["id"]: r for r in call("/api/runs")["runs"]}


def start(body):
    """Reuse a run with identical type, flags, round, replicate and judges; otherwise create it."""
    flags = {k: bool((body.get("flags") or {}).get(k)) for k in ("rubric", "transliterate", "panel")}
    for r in sorted(runs_by_id().values(), key=lambda r: -r["id"]):
        c = r["config"]
        if (r["type"] == body["type"] and c["flags"] == flags and c.get("label", "Round 1") == body["label"]
                and int(c.get("replicate", 0)) == body["replicate"] and sorted(c["judges"]) == sorted(body["judges"])
                ):
            log(f"reusing #{r['id']} {body['type']} {flags} ({r['status']} {r['done']}/{r['total']})")
            if r["status"] in ("created", "stopped", "interrupted", "failed"):
                call(f"/api/runs/{r['id']}/start", {}, run_pw=True)
            return r["id"]
    s = spend()
    if s > BUDGET_STOP:
        stop(f"spend ${s:.2f} is over the ${BUDGET_STOP} guard; not starting {body['type']}")
    r = call("/api/runs", body, run_pw=True)
    log(f"started #{r['id']} {body['label']} {body['type']} {flags} ({r['calls']} calls, {r['cached']} cached)")
    return r["id"]


def wait(ids, label):
    resumes = {i: 0 for i in ids}
    last = 0.0
    while True:
        rs = runs_by_id()
        if time.time() - last > 120:
            log(f"{label}: " + " | ".join(f"#{i} {rs[i]['type']} {rs[i]['done']}/{rs[i]['total']} {rs[i]['status']}" for i in ids)
                + f" | spend ${spend():.2f}")
            last = time.time()
        for i in ids:
            st = rs[i]["status"]
            if st in ("failed", "stopped", "interrupted"):
                err = (rs[i]["error"] or "")[:200]
                if "budget reached" in err:
                    stop(f"run #{i}: {err}")
                if "HTTP 4" in err and "429" not in err:   # a model refuses our request: resuming will not help
                    stop(f"run #{i} {st}: {err}")
                if resumes[i] >= 3:
                    stop(f"run #{i} {st} after 3 resumes: {err}")
                resumes[i] += 1
                log(f"run #{i} {st} ({err}) -> resume {resumes[i]}/3 in 30s")
                time.sleep(30)
                call(f"/api/runs/{i}/start", {}, run_pw=True)
        if all(rs[i]["status"] == "done" for i in ids):
            log(f"{label}: all done (spend ${spend():.2f})")
            return
        time.sleep(20)


def health_check(run_id, judges):
    """After screening: refuse judges that 'think' (long replies) or reply unreadably."""
    rows = call(f"/api/runs/{run_id}/export.json")["results"]
    bad = []
    for j in judges:
        rs = [r for r in rows if r["judge"] == j]
        fresh = [r for r in rs if not r["cached"]]
        avg_out = (sum(r["completion_tokens"] or 0 for r in fresh) / len(fresh)) if fresh else 0
        unp = sum(r["status"] == "unparseable" for r in rs) / max(1, len(rs))
        cost = sum(r["cost"] for r in rs)
        log(f"health {j}: {len(rs)} replies, avg completion tokens {avg_out:.1f}, unparseable {unp:.1%}, cost ${cost:.4f}")
        if avg_out > MAX_AVG_COMPLETION or unp > MAX_UNPARSEABLE:
            bad.append(f"{j} (avg {avg_out:.0f} tokens, {unp:.0%} unparseable)")
    if bad:
        stop("judges unsuitable for the full run: " + "; ".join(bad))


call("/api/auth/login", {"username": user, "password": pw})
log(f"logged in; spend so far ${spend():.2f}")

for rnd in ROUNDS:
    base = {"label": rnd["label"], "replicate": rnd["replicate"], "judges": rnd["judges"]}
    log(f"===== {rnd['label']}: {', '.join(rnd['judges'])}")
    sid = start({**base, "type": "screening"})
    wait([sid], f"{rnd['label']} screening")
    health_check(sid, rnd["judges"])
    status = {j["id"]: j for j in call("/api/overview")["judges"]}
    for j in rnd["judges"]:
        s = status.get(j, {})
        log(f"screening {j}: {s.get('status')} AUC={s.get('auc')}")
    ids = [start({**base, "type": t}) for t in ("comprehension", "pointwise", "pairwise")]
    wait(ids, f"{rnd['label']} main")
    ids = [start({**base, "type": "repeats"}),
           start({**base, "type": "pointwise", "flags": {"rubric": True}}),
           start({**base, "type": "pointwise", "flags": {"transliterate": True}})]
    wait(ids, f"{rnd['label']} mitigations")
    pid = start({**base, "type": "pointwise", "flags": {"panel": True}})
    wait([pid], f"{rnd['label']} panel")
    log(f"===== {rnd['label']} complete")

log(f"ALL ROUNDS DONE. total spend ${spend():.2f}")
