# Technical setup — Script-Bias Audit platform

A small research platform that measures **script bias in LLM judges**: the *same* answer is shown to a judge in
Urdu script, Roman Urdu, English and Urdu–English code-mixed text, and we measure whether the scores change.

```
Backend/    Python 3.11 · FastAPI · SQLite · httpx (OpenRouter) · datasets (Belebele)
Frontend/   Next.js (App Router, TypeScript) · Recharts
docker-compose.yml   builds and runs both with one command
```

## Setup

```bash
sh scripts/init-env.sh            # creates .env with random secrets + an admin login (prints the password)
# edit .env: paste OPENROUTER_API_KEY
docker compose up --build -d      # builds Backend + Frontend, starts both with healthchecks
```

Open `http://<host>:3000` (or the `FRONTEND_PORT` you set) and sign in. Without an API key the whole app still
works with the **mock judge** (`mock/judge`, deterministic, no network).

### HTTPS (recommended on a public server)

Point a domain's DNS at the server, open ports 80 and 443, then set these in `.env`:

```
COMPOSE_PROFILES=https
DOMAIN=audit.example.com
FRONTEND_BIND=127.0.0.1
```

`docker compose up --build -d` then also starts **Caddy**, which gets a Let's Encrypt certificate and serves the app on
`https://audit.example.com`. Port 3000 is then reachable only from the server itself.

## Security

- **Login required for everything.** Every page and every `/api` route checks a signed session cookie
  (HMAC-SHA256, httpOnly, SameSite=Lax, 7-day expiry, `Secure` behind HTTPS). Users come from `APP_USERS`
  (`user:password` pairs, passwords of 12+ characters). Removing a user, or changing `SESSION_SECRET`, signs them out.
- **Brute-force protection:** 8 failed logins per IP or per username lock that key for 15 minutes.
- **CSRF:** state-changing requests must come from the app's own origin.
- **The backend is not public.** It has no published port and refuses every request (except `/api/health`) that
  lacks `BACKEND_TOKEN`, a secret only the frontend proxy holds. If the token is missing or too short, it refuses
  everything. API docs are disabled.
- **The OpenRouter key never leaves the backend container.** It is not sent to the browser or logged. Give the key a
  credit limit on OpenRouter as a final spending cap.
- **Experiment password.** Starting or resuming a run, generating text, or reloading data needs a second password
  (`RUN_PASSWORD`, entered next to "Start run"), so a signed-in user cannot run up costs by accident.
  5 wrong attempts lock that user out of experiments for 10 minutes. The free "Test yourself" tool does not need it.
- **Reviewer identity** is the signed-in user, set server-side, so the browser cannot spoof it.
- Security headers: `X-Frame-Options: DENY`, `nosniff`, `same-origin` referrer, and HSTS behind Caddy.

## Home page

Headline insight cards from the latest finished runs (score gap vs. Urdu script, pairwise preference, comprehension
accuracy, readiness), then **Test yourself**: type a passage/question/answer in each script, **record a voice note**
(transcribed with Whisper via OpenRouter, `[voice] model` in `config.toml`, then auto-filled into all four scripts for
you to check), or pull a random question from the dataset, and see each judge's scores and picks side by side.

## Contributors

Edit `Frontend/lib/contributors.ts` (names, roles, links) and put photos in `Frontend/public/contributors/`.

## Workflow

1. **Data**: *Load Belebele* samples 300 parallel items (`urd_Arab`, `urd_Latn`, `eng_Latn`, joined on
   `link` + `question_number`) with a fixed seed. Each item gets one correct and one deterministically chosen wrong answer.
2. **Generate** `roman_translit` (all items) and `code_mixed` (first 100 items) on the Data page.
3. **Review**: approve, edit or reject each generated item (keys: `A` approve, `E` edit, `R` reject, `J`/`K` next/previous,
   `⌘/Ctrl+Enter` save edit). Only **approved** items are used in runs. The signed-in user is recorded as the reviewer.
4. **Runs**: pick a run type, judges, conditions and item count. You see the number of calls, how many are
   already cached, and an estimated cost before starting. Runs show live progress and can be stopped and resumed.
5. **Results**: charts and tables per judge, plus CSV / JSON export.

### Run the 20-item pilot

On **Runs**, choose **Screening** (it defaults to the first `pilot_items = 20` items, Urdu script vs. English,
correct vs. wrong) and start it. The Overview then shows pass/fail per judge (AUC > `screening_auc_threshold` = 0.7 in
**both** conditions). For a full 20-item pilot of everything, run Comprehension, Pointwise and Pairwise with
*Items = 20*.

## Adding a judge

Edit `Backend/config.toml` (mounted into the container, so no rebuild is needed), then run `docker compose restart backend`:

```toml
[[judges]]
id = "anthropic/claude-haiku-4.5"   # any OpenRouter model ID
reasoning_off = true                # sends reasoning: {enabled: false}
# max_tokens = 8                    # optional override
```

Every call uses temperature 0 and a small `max_tokens`. Prompts are plain text files in `Backend/prompts/`.

## Experiments

| Run type | What it does |
|---|---|
| Screening | Pointwise on Urdu script + English, pilot subset → AUC gate. Failed judges can still run, but those runs are flagged. |
| Comprehension | The judge answers the 4-option question itself, in each condition → accuracy. |
| Pointwise | "Rate 1–10" on correct and wrong answers. Mitigation flags: `rubric`, `transliterate` (convert Roman / code-mixed to Urdu script first), `panel` (average all selected judges). |
| Pairwise | Each condition vs. Urdu script, both orders (AB and BA). Ties count 0.5. |
| Repeats | Pointwise on a subset (default 50 items) with 2 extra repeats → per-item variance. |
| Generate | LLM transliteration / code-mixing into the review queue. |

Metrics: per judge × condition, with **bootstrap 95% CIs** (1,000 seeded resamples): mean score and paired gap vs.
Urdu script, AUC, separation, acceptance rate (≥ 7), win rate, comprehension accuracy and consistency.
**Ties and unparseable outputs are counted separately** and never treated as failures.

## Where raw outputs are stored

All in the `data` Docker volume (`/data` in the backend container):

- `/data/audit.db`: SQLite.
  - `cache`: **every model call**: requested and served model ID, provider, full prompt, raw response, tokens, cost, timestamp.
  - `results`: one row per task: raw text, parsed value, status, model, provider, timestamp, cost.
  - `items`, `generated` (with review status, reviewer and time), and `runs`.
- `/data/exports/run_<id>.csv|json`: written automatically when a run finishes.
- `/data/hf`: Hugging Face dataset cache.

Copy them out with: `docker compose cp backend:/data/exports ./exports`.

**Exporting:** use the *Export CSV / JSON* buttons on Results, or `GET /api/runs/<id>/export.csv` / `export.json`.

## Caching, resume, cost

- Each call is cached by `sha256(model, full prompt, params, repeat index)`. Re-running a finished run costs nothing.
- If the server crashes mid-run, the run shows as *interrupted*. Press **Resume** and only the missing tasks run.
- Retries use exponential backoff on 429, 5xx and network errors. Concurrency is set by `concurrency` in `config.toml`.
- Cost comes from OpenRouter's `usage.cost` and is shown per run and in total on the Overview.

## Tests

```bash
make test
# or, without make:
docker compose build backend frontend-test
docker compose run --rm --no-deps backend pytest
docker compose --profile test run --rm frontend-test
```

The backend suite covers parsing, every metric against hand-computed values (including the worked example in the brief),
cache hits, retries, crash and resume, and an end-to-end run through the HTTP API with the mock judge on 10 items.
The backend suite also checks the backend-token gate. The frontend suite has a smoke test that renders the Overview
with mock data, plus tests for session signing (tampering, expiry), user parsing and the origin check.
Tests need a `.env`, because compose refuses to start without the secrets.

The UI is light by default. The moon/sun button in the nav switches to dark mode, and each browser remembers the choice.

## Familiarity (optional, local GPU)

Perplexity per character of each answer under a local Hugging Face model (APIs do not return prompt log-probabilities):

```bash
pip install -r Backend/requirements-familiarity.txt
cd Backend && DATA_DIR=<path to data> python -m scripts.familiarity --model Qwen/Qwen2.5-0.5B
```

It skips gracefully if there is no GPU (pass `--cpu` to force CPU). Output: `exports/familiarity.csv`.

## Design choices worth knowing

- **Generated text is reviewed per item.** All 4 options are generated in one call, so comprehension also works for
  `roman_translit` and `code_mixed`. Their passage and question are Belebele's `urd_Latn` text.
- **Pairwise** shows each answer with the passage and question in that answer's own script.
- **Repeats** add the repeat index to the cache key, so they are real new calls (the repeat-0 call is shared with the
  normal pointwise run).
- Items whose correct answer differs between configs are dropped when joining.
