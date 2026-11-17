"""EdgeScout v2 full LangGraph: parallel fan-out, deterministic
evaluation, human-in-the-loop escalation, and fallback.

Pipeline: security triage + Pinecone comps + API valuation run in
parallel, a synthesizer merges them into a draft report, and a
zero-token evaluator (regex secret scan + strict Pydantic schema)
either accepts it, loops it back for self-healing, escalates
HIGH/CRITICAL risk to a human, or falls back to a hard-clamped
safe payload after 3 failed retries.

NOTE: the "secret" in the first synthesizer draft (``sec_live_...``)
is an intentionally fake demo value so the evaluator has something
to catch on attempt 0. The valuation and security workers now use
LIVE free data (see ``market.py``): CoinGecko for the WETH price and
GoPlus for contract safety checks. Pinecone retrieval is live when
``PINECONE_API_KEY`` is set (see ``retrieval.py``) and simulated
otherwise. The only remaining stub is the valuation model's 0.094
WETH comp estimate itself, until a real Nansen key (paid) or a
comps database is wired in.

``build_edgescout_workflow()`` returns the uncompiled workflow so
``persistence.build_durable_edgescout_graph()`` can compile the same
graph against a Postgres checkpointer instead of the in-memory one.
"""

import operator
import re
from typing import Annotated, Dict, List, Literal, Optional, TypedDict
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field, ValidationError

from .market import (
    derive_security_assessment,
    fetch_token_security,
    fetch_weth_usd_price,
    is_contract_address,
)
from .retrieval import hybrid_pinecone_retrieval_node


# =====================================================================
# 1. STRICT PYDANTIC OUTPUT CONTRACT (UI & API Guarantee)
# =====================================================================
class EdgeScoutReport(BaseModel):
  target: str
  risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
  risk_score: float = Field(ge=0.0, le=1.0)
  estimated_value: float = Field(ge=0.0)
  currency: str
  estimated_value_usd: Optional[float] = None
  confidence: float = Field(ge=0.0, le=1.0)
  security_flags: List[str]
  executive_summary: str


# =====================================================================
# 2. LANGGRAPH TYPED STATE SCHEMA
# =====================================================================
class EdgeScoutState(TypedDict):
  target: str
  # Parallel worker outputs
  security_data: Dict
  pinecone_comps: List[Dict]
  valuation_data: Dict
  # Evaluator-Optimizer loop state
  draft_payload: Dict
  validated_report: Optional[Dict]
  validation_errors: List[str]
  retry_count: int
  # Telemetry & accumulated errors
  errors: Annotated[List[str], operator.add]


# =====================================================================
# 3. SECURITY UTILITY: QUARANTINE & REGEX REDACTION
# =====================================================================
SENSITIVE_PATTERNS = [
    r"sk-[a-zA-Z0-9]{20,}",  # OpenAI/API keys
    r"sec_live_[a-zA-Z0-9]+",  # Live secret tokens
    r"Bearer\s+[a-zA-Z0-9\-\._~\+\/]+=*",  # Auth headers
    r"0x[a-fA-F0-9]{64}",  # Raw 64-char private keys
]


def quarantine_untrusted_text(raw_text: str) -> str:
  """Isolates external metadata so downstream LLMs treat it strictly as data, not instructions."""
  cleaned = raw_text.replace("</untrusted_data>", "[STRIPPED_TAG]")
  return f"<untrusted_data>\n{cleaned}\n</untrusted_data>"


# =====================================================================
# 4. PARALLEL FAN-OUT WORKERS (Fault-Tolerant & Read-Only)
# =====================================================================
def security_triage_worker(state: EdgeScoutState) -> Dict:
  target = state["target"]
  try:
    # LIVE: GoPlus security check when the target is a contract address.
    # Domain targets (e.g. darkone.x) have no contract address to check,
    # so they stay "unverified" until an address is supplied.
    if is_contract_address(target):
      live = fetch_token_security(target)
      if live is not None:
        assessment = derive_security_assessment(live)
        return {
            "security_data": {
                "risk_score": assessment["risk_score"],
                "flags": assessment["flags"],
                "raw_note": quarantine_untrusted_text(
                    "GoPlus live token security check"
                ),
                "source": "goplus_live",
            }
        }
      return {
          "security_data": {
              "risk_score": 1.0,
              "flags": ["triage_api_timeout"],
              "raw_note": "",
              "source": "goplus_live",
          },
          "errors": ["Security Triage failed: GoPlus API unreachable"],
      }
    return {
        "security_data": {
            "risk_score": 0.15,
            "flags": ["unverified_proxy_check"],
            "raw_note": quarantine_untrusted_text(
                "Token metadata: Safe transfer"
            ),
            "source": "no_contract_address",
        }
    }
  except Exception as e:
    return {
        "security_data": {
            "risk_score": 1.0,
            "flags": ["triage_api_timeout"],
            "raw_note": "",
            "source": "goplus_live",
        },
        "errors": [f"Security Triage failed: {str(e)}"],
    }


def pinecone_retrieval_worker(state: EdgeScoutState) -> Dict:
  # Delegates to retrieval.py: live Pinecone fetch when PINECONE_API_KEY
  # is set, simulated comps otherwise.
  try:
    return hybrid_pinecone_retrieval_node(state)
  except Exception as e:
    return {
        "pinecone_comps": [],
        "errors": [f"Pinecone Lookup failed: {str(e)}"],
    }


def api_valuation_worker(state: EdgeScoutState) -> Dict:
  target = state["target"]
  try:
    # LIVE: current WETH price in USD (CoinGecko free API, no key).
    # The 0.094 WETH comp estimate is still the model's output until a
    # real Nansen key (paid) or comps database is wired in — but the
    # dollar value is now computed from the live market, not a guess.
    weth_usd = fetch_weth_usd_price()
    estimated_weth = 0.094
    valuation = {
        "estimated_value": estimated_weth,
        "currency": "WETH",
        "confidence": 0.88,
    }
    if weth_usd is not None:
      valuation["weth_usd_price"] = weth_usd
      valuation["estimated_value_usd"] = round(estimated_weth * weth_usd, 2)
      valuation["price_source"] = "coingecko_live"
    else:
      valuation["price_source"] = "coingecko_unreachable"
    return {"valuation_data": valuation}
  except Exception as e:
    return {
        "valuation_data": {
            "estimated_value": 0.0,
            "currency": "WETH",
            "confidence": 0.0,
        },
        "errors": [f"Valuation API failed: {str(e)}"],
    }


# =====================================================================
# 5. FAN-IN SYNTHESIZER (Generator Node)
# =====================================================================
def synthesizer_node(state: EdgeScoutState) -> Dict:
  """Merges parallel signals into a structured draft.

  In production, pass state + validation_errors to Gemini to generate/fix JSON.
  """
  sec = state.get("security_data", {})
  val = state.get("valuation_data", {})
  comps = state.get("pinecone_comps", [])
  errors = state.get("validation_errors", [])

  # Simulate fixing an error on retry
  if errors:
    print(f"[Synthesizer] Self-healing based on evaluator feedback: {errors}")

  # Simulated structured output from LLM
  risk_score = sec.get("risk_score", 1.0)
  risk_level = (
      "CRITICAL"
      if risk_score >= 0.8
      else "HIGH"
      if risk_score >= 0.6
      else "MEDIUM"
      if risk_score >= 0.3
      else "LOW"
  )

  # On attempt 0, simulate an accidental secret leak to prove the guardrail works
  secret_leak = (
      " Debug key: sec_live_987654321" if state["retry_count"] == 0 else ""
  )

  draft = {
      "target": state["target"],
      "risk_level": risk_level,
      "risk_score": risk_score,
      "estimated_value": val.get("estimated_value", 0.0),
      "currency": val.get("currency", "WETH"),
      "estimated_value_usd": val.get("estimated_value_usd"),
      "confidence": val.get("confidence", 0.0),
      "security_flags": sec.get("flags", []),
      "executive_summary": (
          f"Matched {len(comps)} historical comps. Valuation sits at "
          f"{val.get('estimated_value')} {val.get('currency')}.{secret_leak}"
      ),
  }

  return {"draft_payload": draft, "retry_count": state["retry_count"] + 1}


# =====================================================================
# 6. DETERMINISTIC EVALUATOR (Zero-Token Pydantic + Regex Guardrail)
# =====================================================================
def deterministic_evaluator_node(state: EdgeScoutState) -> Dict:
  draft = state["draft_payload"]
  validation_errors = []

  # Check A: Regex scan across serialized payload for leaked secrets/keys
  serialized = str(draft)
  for pattern in SENSITIVE_PATTERNS:
    if re.search(pattern, serialized):
      validation_errors.append(
          f"SECURITY BREACH: Output matched sensitive key pattern '{pattern}'."
      )

  # Check B: Strict Pydantic Schema & Numeric Bounds Validation
  try:
    validated = EdgeScoutReport(**draft).model_dump()
  except ValidationError as e:
    validated = None
    for err in e.errors():
      validation_errors.append(
          f"SCHEMA ERROR at {err['loc']}: {err['msg']}"
      )

  if validation_errors:
    return {
        "validated_report": None,
        "validation_errors": validation_errors,
    }

  return {"validated_report": validated, "validation_errors": []}


# =====================================================================
# 7. HUMAN-IN-THE-LOOP ESCALATION GATE (Mobile Approval Pause)
# =====================================================================
def human_escalation_node(state: EdgeScoutState) -> Dict:
  """Pauses execution via LangGraph interrupt() if risk is HIGH/CRITICAL."""
  report = state["validated_report"]
  decision = interrupt({
      "alert": "High-risk asset or anomaly detected. Manual review required.",
      "target": report["target"],
      "risk_level": report["risk_level"],
      "flags": report["security_flags"],
  })
  # Resumes here once user approves/rejects from Base44 UI
  report["executive_summary"] += f" [Human Review Decision: {decision}]"
  return {"validated_report": report}


# =====================================================================
# 8. CONDITIONAL ROUTING & GRAPH COMPILATION
# =====================================================================
def route_after_evaluation(state: EdgeScoutState) -> str:
  if state.get("validated_report") is not None:
    # Passed schema & security checks! Check if risk level requires human sign-off
    if state["validated_report"]["risk_level"] in ["HIGH", "CRITICAL"]:
      return "escalate"
    return "complete"

  if state["retry_count"] >= 3:
    return "fallback"

  return "retry"


def deterministic_fallback_node(state: EdgeScoutState) -> Dict:
  """Hard-clamped safe payload if LLM fails validation 3 times."""
  safe_report = EdgeScoutReport(
      target=state["target"],
      risk_level="HIGH",
      risk_score=1.0,
      estimated_value=0.0,
      currency="WETH",
      confidence=0.0,
      security_flags=["validation_circuit_breaker_triggered"],
      executive_summary=(
          "Automated synthesis failed strict validation guardrails."
      ),
  ).model_dump()
  return {"validated_report": safe_report}


def build_edgescout_workflow():
  """Build the EdgeScout workflow (uncompiled, so any checkpointer can be used)."""
  workflow = StateGraph(EdgeScoutState)

  # Register Nodes
  workflow.add_node("security_triage", security_triage_worker)
  workflow.add_node("pinecone_lookup", pinecone_retrieval_worker)
  workflow.add_node("api_valuation", api_valuation_worker)
  workflow.add_node("synthesizer", synthesizer_node)
  workflow.add_node("evaluator", deterministic_evaluator_node)
  workflow.add_node("human_escalation", human_escalation_node)
  workflow.add_node("fallback_sanitizer", deterministic_fallback_node)

  # Fan-Out
  workflow.add_edge(START, "security_triage")
  workflow.add_edge(START, "pinecone_lookup")
  workflow.add_edge(START, "api_valuation")

  # Fan-In
  workflow.add_edge("security_triage", "synthesizer")
  workflow.add_edge("pinecone_lookup", "synthesizer")
  workflow.add_edge("api_valuation", "synthesizer")

  # Validation Loop
  workflow.add_edge("synthesizer", "evaluator")
  workflow.add_conditional_edges(
      "evaluator",
      route_after_evaluation,
      {
          "complete": END,
          "escalate": "human_escalation",
          "retry": "synthesizer",
          "fallback": "fallback_sanitizer",
      },
  )

  workflow.add_edge("human_escalation", END)
  workflow.add_edge("fallback_sanitizer", END)

  return workflow


def build_edgescout_graph():
  # Compile with Checkpointer (Use PostgresSaver in production — see persistence.py)
  checkpointer = MemorySaver()
  return build_edgescout_workflow().compile(checkpointer=checkpointer)


# =====================================================================
# EXAMPLE RUN
# =====================================================================
if __name__ == "__main__":
  app = build_edgescout_graph()
  config = {"configurable": {"thread_id": "edgescout_session_001"}}

  initial_state = {
      "target": "darkone.x",
      "security_data": {},
      "pinecone_comps": [],
      "valuation_data": {},
      "draft_payload": {},
      "validated_report": None,
      "validation_errors": [],
      "retry_count": 0,
      "errors": [],
  }

  result = app.invoke(initial_state, config=config)
  print("\n=== Final Validated EdgeScout JSON ===")
  print(result["validated_report"])
