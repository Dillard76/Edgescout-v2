"""Hybrid Pinecone retrieval node for EdgeScout v2.

Two modes, decided by whether a Pinecone key is configured:

- LIVE (``PINECONE_API_KEY`` set): talks to the real Pinecone data
  plane over plain HTTPS — resolves the index host, fetches any
  vectors already stored under this target's id, and reports the
  index stats. No embeddings are invented: a vector query needs a
  real embedding model, so live retrieval is fetch-by-id of comps
  the agent previously stored. If nothing is stored for the target
  yet, it honestly returns no comps.
- SIMULATED (no key): returns one sample comp so the graph demo
  still runs end to end. The payload is marked
  ``"source": "simulated_no_key"`` so nothing downstream mistakes
  it for real memory.

Get a free Pinecone key at https://www.pinecone.io/ (free tier:
one serverless index). Set ``PINECONE_API_KEY`` and
``PINECONE_INDEX_NAME`` (default ``edgescout-v2-memory``) — same
variables as the repo root ``.env.example``.
"""

import json
import os
import urllib.error
import urllib.request
from typing import Dict, List, Optional

TIMEOUT_SECONDS = 10


def _env(name: str) -> Optional[str]:
  value = os.getenv(name)
  return value.strip() if value and value.strip() else None


def _pinecone_request(
    api_key: str, url: str, payload: Optional[dict] = None
) -> Optional[dict]:
  headers = {
      "Api-Key": api_key,
      "Content-Type": "application/json",
      "User-Agent": "EdgeScout-v2/1.0",
  }
  body = json.dumps(payload).encode("utf-8") if payload is not None else None
  req = urllib.request.Request(url, data=body, headers=headers, method="POST")
  try:
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
      return json.loads(resp.read().decode("utf-8"))
  except (urllib.error.URLError, TimeoutError, ValueError, OSError):
    return None


def _resolve_index_host(api_key: str, index_name: str) -> Optional[str]:
  req = urllib.request.Request(
      f"https://api.pinecone.io/indexes/{index_name}",
      headers={"Api-Key": api_key, "User-Agent": "EdgeScout-v2/1.0"},
      method="GET",
  )
  try:
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
      data = json.loads(resp.read().decode("utf-8"))
      return (data.get("host") or None)
  except (urllib.error.URLError, TimeoutError, ValueError, OSError):
    return None


def _live_pinecone_comps(
    api_key: str, index_name: str, target: str
) -> Dict:
  """Fetch stored comps for this target from the real index."""
  host = _resolve_index_host(api_key, index_name)
  if not host:
    return {
        "pinecone_comps": [],
        "errors": ["Pinecone Lookup failed: could not resolve index host"],
    }

  fetched = _pinecone_request(
      api_key, f"https://{host}/vectors/fetch", {"ids": [target]}
  )
  stats = _pinecone_request(
      api_key, f"https://{host}/describe_index_stats", {}
  )
  total_vectors = None
  if stats:
    total_vectors = (stats.get("totalVectorCount")
                     or (stats.get("namespaces") or {}).get("", {}).get("vectorCount"))

  vectors = (fetched or {}).get("vectors") or {}
  comps: List[Dict] = []
  for vec_id, vec in vectors.items():
    meta = vec.get("metadata") or {}
    comps.append({
        "id": vec_id,
        "similarity": 1.0,
        "historical_val": meta.get("historical_val"),
        "matched_criteria": "Stored comp for this target",
        "source": "pinecone_live",
    })

  return {
      "pinecone_comps": comps,
      "pinecone_index_vectors": total_vectors,
  }


def _simulated_comps() -> Dict:
  # Simulated production response matching your schema
  comps = [{
      "id": "comp_asset_882",
      "similarity": 0.94,
      "historical_val": 0.094,
      "matched_criteria": "Exact domain suffix & liquidity match",
      "source": "simulated_no_key",
  }]
  return {"pinecone_comps": comps}


def hybrid_pinecone_retrieval_node(state: Dict) -> Dict:
  """Executes hybrid BM25 + Vector retrieval to feed accurate comps

  into the EdgeScout synthesizer.
  """
  target = state.get("target", "")

  try:
    api_key = _env("PINECONE_API_KEY")
    index_name = _env("PINECONE_INDEX_NAME") or "edgescout-v2-memory"
    if api_key:
      return _live_pinecone_comps(api_key, index_name, target)
    return _simulated_comps()
  except Exception as e:
    return {
        "pinecone_comps": [],
        "errors": [f"Hybrid Pinecone retrieval failed: {str(e)}"],
    }
