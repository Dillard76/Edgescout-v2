"""Evaluator-Optimizer loop (standalone demo graph).

A small LangGraph that drafts a valuation report, runs it past a
deterministic critic (secret redaction + confidence bounds), and loops
back to the generator until the draft passes or retries run out.

NOTE: the "secret" values in the first draft (e.g. ``sec_live_...``)
are intentionally fake demo values. They exist so the evaluator has
something to catch on attempt 0 — the loop proves the guardrail works.
"""

from typing import Dict, List, TypedDict
from langgraph.graph import END, START, StateGraph


# 1. State Schema tracking iterations and validation feedback
class EvaluationState(TypedDict):
  target: str
  raw_valuation_data: Dict
  draft_report: str
  validation_errors: List[str]
  iteration_count: int
  is_valid: bool


# 2. Generator Node: Drafts the valuation payload and report
def generator_node(state: EvaluationState) -> Dict:
  print(
      f"\n[Generator] Drafting report (Attempt"
      f" {state['iteration_count'] + 1})..."
  )

  # If there are previous validation errors, simulate fixing them based on feedback
  errors = state.get("validation_errors", [])
  if errors:
    print(
        f"[Generator] Refining output based on critic feedback: {errors}"
    )

  # Simulated draft generation (In production, this is an LLM call or synthesis script)
  # Intentionally introduce a sensitive token or invalid confidence on the first try to show the loop in action
  if state["iteration_count"] == 0:
    draft = (
        f"### Valuation for {state['target']}\n"
        f"- Estimated Value: 0.094 WETH\n"
        f"- Confidence: 1.5\n"  # Invalid confidence > 1.0
        f"- API_SECRET_KEY: sec_live_998877665544\n"  # Sensitive leak!
    )
  else:
    # Fixed version on retry
    draft = (
        f"### Valuation for {state['target']}\n"
        f"- Estimated Value: 0.094 WETH\n"
        f"- Confidence: 0.85\n"
        f"- API_SECRET_KEY: [REDACTED]\n"
    )

  return {
      "draft_report": draft,
      "iteration_count": state["iteration_count"] + 1,
  }


# 3. Evaluator / Critic Node: Enforces strict guardrails
def evaluator_node(state: EvaluationState) -> Dict:
  print("[Evaluator] Inspecting draft for schema, bounds, and redactions...")
  draft = state["draft_report"]
  errors = []

  # Guardrail 1: Check for unredacted sensitive keys or API tokens
  sensitive_keywords = ["sec_live_", "Bearer ", "private_key", "sk_"]
  for kw in sensitive_keywords:
    if kw in draft:
      errors.append(
          f"Security Violation: Unredacted sensitive token keyword found ('{kw}')."
      )

  # Guardrail 2: Check numerical bounds (e.g., Confidence must be between 0.0 and 1.0)
  if "Confidence: " in draft:
    try:
      # Simple string parsing for demo purposes
      conf_line = [
          line for line in draft.split("\n") if "Confidence: " in line
      ][0]
      conf_val = float(conf_line.split("Confidence: ")[1])
      if not (0.0 <= conf_val <= 1.0):
        errors.append(
            f"Schema Error: Confidence score {conf_val} is out of bounds [0.0,"
            " 1.0]."
        )
    except Exception:
      errors.append("Schema Error: Unable to parse confidence score.")

  is_valid = len(errors) == 0
  if is_valid:
    print("[Evaluator] ✅ Draft passed all guardrails.")
  else:
    print(f"[Evaluator] ❌ Validation failed with {len(errors)} error(s).")

  return {"validation_errors": errors, "is_valid": is_valid}


# 4. Routing Logic: Decides whether to loop back or finish
def should_continue(state: EvaluationState) -> str:
  if state["is_valid"]:
    return "accept"
  elif state["iteration_count"] >= 3:
    print("⚠️ Max retries reached. Forcing fallback output.")
    return "max_retries"
  else:
    return "retry"


# 5. Fallback Sanitizer Node (If max retries are exceeded)
def fallback_sanitizer_node(state: EvaluationState) -> Dict:
  print("[Fallback] Forcing automated redaction and boundary clamping...")
  # Force clean standard template
  safe_report = (
      f"### Valuation for {state['target']} (Sanitized)\n"
      f"- Status: Review Required\n"
      f"- Estimated Value: 0.094 WETH\n"
      f"- Confidence: 0.5 (Clamped)\n"
      f"- Security Status: Sanitized by Fallback Guardrail\n"
  )
  return {"draft_report": safe_report, "is_valid": True}


# 6. Build and Compile Graph
def build_evaluator_optimizer_graph():
  workflow = StateGraph(EvaluationState)

  workflow.add_node("generator", generator_node)
  workflow.add_node("evaluator", evaluator_node)
  workflow.add_node("fallback_sanitizer", fallback_sanitizer_node)

  workflow.add_edge(START, "generator")
  workflow.add_edge("generator", "evaluator")

  # Conditional routing based on evaluator results
  workflow.add_conditional_edges(
      "evaluator",
      should_continue,
      {
          "accept": END,
          "retry": "generator",  # Loops back to generator with errors in state
          "max_retries": "fallback_sanitizer",
      },
  )

  workflow.add_edge("fallback_sanitizer", END)

  return workflow.compile()


if __name__ == "__main__":
  app = build_evaluator_optimizer_graph()
  initial_state = {
      "target": "darkone.x",
      "raw_valuation_data": {"value": 0.094},
      "draft_report": "",
      "validation_errors": [],
      "iteration_count": 0,
      "is_valid": False,
  }

  final_state = app.invoke(initial_state)
  print("\n=== Final Output Report ===")
  print(final_state["draft_report"])
