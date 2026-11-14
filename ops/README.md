# Experiment drivers

Scripts that run whole experiments through the live platform's API (the same path as the Experiments page).
They read the login and experiment password from the server's `.env`; no secrets are stored here.

- `run_experiment.py` — Round 1: screening, then comprehension / pointwise / pairwise, then repeats and the three
  mitigations, then the panel.
- `run_rounds.py` — Rounds 2–4 (replication, medium, large) with guards: screens each new model first and stops on
  "thinking" models, unreadable replies, a model refusing requests, or total spend above $28 (the backend hard-caps
  all spend at $30).

Run on the server so it keeps going when your laptop is off:

    scp -i LLM-Testing.pem ops/run_rounds.py ec2-user@3.0.35.127:app/
    ssh -i LLM-Testing.pem ec2-user@3.0.35.127 \
      'cd ~/app && nohup python3 -u run_rounds.py https://3-0-35-127.sslip.io /home/ec2-user/app/.env >> rounds.log 2>&1 &'

Both are idempotent: finished runs are reused, interrupted or failed ones are resumed, and every answer is cached, so
re-running never pays twice. Edit the `ROUNDS` list to change judges or add a round.
