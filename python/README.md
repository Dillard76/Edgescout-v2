# EdgeScout v2 — Python agent (LangGraph)

Python side of EdgeScout v2: the LangGraph agent that values and
risk-scores Web3 domains (like `darkone.x`), with a deterministic
evaluator-optimizer loop, a human escalation gate, and Prometheus
observability. The TypeScript app (`server.ts`, `src/`) stays as-is;
this package is the agent brain.

## Layout

| Path | What it is |
| --- | --- |
| `edgescout/evaluator_optimizer.py` | Standalone demo graph: generator drafts a valuation report, a critic enforces redaction + confidence bounds, loops back until it passes (max 3 retries, then a sanitized fallback). |
| `edgescout/graph.py` | The full EdgeScout graph: parallel fan-out (security triage, Pinecone comps, API valuation) → synthesizer → deterministic evaluator (regex secret scan + strict Pydantic schema) → human escalation on HIGH/CRITICAL risk, or fallback after 3 failed retries. |
| `edgescout/retrieval.py` | Pinecone retrieval node: live fetch-by-id + index stats when `PINECONE_API_KEY` is set, one marked simulated comp otherwise. |
| `edgescout/market.py` | Free live data with no key: CoinGecko WETH price + GoPlus token security checks. |
| `.env.example` | Environment variables (copy to `.env`, never commit it). |
| `edgescout/persistence.py` | Durable Postgres checkpointing via a connection pool. Returns `(app, pool)` — keep the pool open while the app runs. |
| `edgescout/observability/validation_gate.py` | `@validate_pipeline_output` decorator: structural + domain checks on pipeline outputs, with Prometheus counters/histograms. Works without `prometheus_client` installed (metrics skipped). |
| `edgescout/observability/alerts.yml` | Prometheus alerting rules: validation failure rate > 10%, low-confidence spike. |
| `requirements.txt` | `langgraph`, `langgraph-checkpoint-postgres`, `psycopg[binary]`, `pydantic`, `prometheus_client>=0.17.0`. |

## Setup

```bash
cd python
pip install -r requirements.txt
```

## Run the demos

```bash
cd python
python -m edgescout.evaluator_optimizer   # small evaluator-optimizer loop
python -m edgescout.graph                 # full graph, in-memory checkpoint
python -m edgescout.persistence           # full graph, Postgres checkpoint
```

For the Postgres run, set `DATABASE_URL` first:

```bash
export DATABASE_URL="postgresql://langgraph_app:<password>@<host>:5432/langgraph"
```

`checkpointer.setup()` creates the checkpoint tables — run it once
per database (it is safe to re-run; tables are created IF NOT EXISTS).

## Thread IDs are mobile session keys

Always pass a unique `thread_id` tied to the user's mobile session
or asset lookup in the execution config (must be under 255 chars):

```python
config = {"configurable": {"thread_id": "mobile_session_darkone.x_094"}}
result = app.invoke(initial_state, config=config)
```

## Notes

- **Duplicates removed:** the full graph and the validation gate
  were pasted more than once (the graph twice, the gate three
  times). One copy of each is kept here — the complete graph and
  the Prometheus version of the gate.
- **One fix in `persistence.py`:** the `PostgresSaver.from_conn_string`
  snippet in the notes returns the compiled app from inside a `with`
  block, which closes the connection on exit and leaves the app with
  a dead checkpointer. The pool version here fixes that.
- **Demo secrets are fake:** the `sec_live_...` values in the first
  drafts are intentionally fake, so the evaluator has something to
  catch on attempt 0. Never put real keys in code.
## Real data (#1) — what is live and what still needs a key

- **Live now, no key:** the valuation worker prices WETH from
  CoinGecko's free API, and the security worker runs a real GoPlus
  check whenever the target is a contract address (honeypot, taxes,
  proxy, open-source). If either API is unreachable the worker
  falls back safely and says so in the output.
- **Live with a free key:** Pinecone retrieval. Create a free
  account at https://www.pinecone.io/ (one serverless index on the
  free tier), copy the key into `.env` as `PINECONE_API_KEY`, and
  the retrieval node fetches comps the agent actually stored
  instead of the sample. Same variables as the repo root
  `.env.example`.
- **Still simulated:** the 0.094 WETH comp estimate itself — the
  model has no comps database yet. Once Pinecone holds real stored
  valuations, retrieval returns those instead. Nansen is paid, so
  no Nansen key is needed for anything here yet.
- **Validation gate wiring:** import it in a node module and decorate
  the node, e.g. the vision pricer:

```python
from edgescout.observability.validation_gate import validate_pipeline_output

@validate_pipeline_output(
    expected_fields=["item_id", "estimated_value", "confidence_score"],
    min_confidence=0.6,
    max_price_limit=10000.0,
)
def vision_pricer_node(state_payload: dict) -> dict:
    ...
```

- **Incident runbooks:** the alerts reference
  `https://github.com/your-org/edgescout/wiki/Incident-Runbooks` —
  update that URL to the real wiki when it exists.
