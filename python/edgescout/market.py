"""Free, no-key live data sources for EdgeScout v2.

These are the real-data backends behind the graph workers — no API
keys required, so they work out of the box:

- CoinGecko free API: live WETH (and ETH) price in USD. Used by the
  valuation worker to anchor the WETH estimate in dollars.
- GoPlus Security API: live token safety checks (honeypot, proxy,
  taxes, open-source status) for a contract address. Used by the
  security triage worker when the target is a 0x address.

Anything that needs a paid key (Nansen) or a free-tier key (Pinecone)
lives elsewhere: Pinecone retrieval is in ``retrieval.py`` and only
runs live when ``PINECONE_API_KEY`` is set.

All fetchers return ``None`` on failure (network error, timeout,
unexpected payload) so callers can fall back gracefully instead of
crashing the graph.
"""

import json
import re
import urllib.error
import urllib.request
from typing import Dict, List, Optional

TIMEOUT_SECONDS = 10
_USER_AGENT = {"User-Agent": "EdgeScout-v2/1.0 (free-tier market data)"}

# WETH contract on Ethereum mainnet — used to demo/test the GoPlus check.
WETH_CONTRACT = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"

_CONTRACT_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def is_contract_address(target: str) -> bool:
  """True when the target looks like an EVM contract address."""
  return bool(_CONTRACT_RE.match(target.strip()))


def _get_json(url: str) -> Optional[dict]:
  req = urllib.request.Request(url, headers=_USER_AGENT)
  try:
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
      return json.loads(resp.read().decode("utf-8"))
  except (urllib.error.URLError, TimeoutError, ValueError, OSError):
    return None


# =====================================================================
# CoinGecko: live WETH / ETH price (free, no key)
# =====================================================================
def fetch_weth_usd_price() -> Optional[float]:
  """Live WETH price in USD from CoinGecko's free endpoint."""
  data = _get_json(
      "https://api.coingecko.com/api/v3/simple/price"
      "?ids=weth,ethereum&vs_currencies=usd"
  )
  if not data:
    return None
  for coin in ("weth", "ethereum"):
    price = (data.get(coin) or {}).get("usd")
    if isinstance(price, (int, float)) and price > 0:
      return float(price)
  return None


# =====================================================================
# GoPlus: live token security (free, no key)
# =====================================================================
def fetch_token_security(
    address: str, chain_id: int = 1
) -> Optional[Dict]:
  """Live GoPlus token_security result for one contract address.

  Returns the per-address result dict (honeypot, taxes, proxy, ...),
  or None when the API is unreachable or returns no data.
  """
  data = _get_json(
      "https://api.gopluslabs.io/api/v1/token_security/"
      f"{chain_id}?contract_addresses={address}"
  )
  if not data or data.get("code") != 1:
    return None
  result = data.get("result") or {}
  # GoPlus keys the result by lowercase address.
  return result.get(address.lower()) or result.get(address)


def derive_security_assessment(
    token_security: Dict,
) -> Dict[str, object]:
  """Turn a GoPlus result into EdgeScout's risk_score + flags."""
  flags: List[str] = []
  risk = 0.15  # Base: live check ran, nothing alarming found.

  def _num(value, default=0.0) -> float:
    try:
      return float(value)
    except (TypeError, ValueError):
      return default

  if token_security.get("is_honeypot") == "1":
    risk = 1.0
    flags.append("honeypot")
  if token_security.get("cannot_buy") == "1":
    risk = max(risk, 0.9)
    flags.append("cannot_buy")
  if token_security.get("cannot_sell_all") == "1":
    risk = max(risk, 0.9)
    flags.append("cannot_sell_all")
  if (
      _num(token_security.get("buy_tax")) > 10
      or _num(token_security.get("sell_tax")) > 10
  ):
    risk = max(risk, 0.6)
    flags.append("high_transfer_tax")
  if token_security.get("is_open_source") == "0":
    risk = max(risk, 0.4)
    flags.append("closed_source")
  if token_security.get("is_proxy") == "1":
    risk = max(risk, 0.25)
    flags.append("proxy_contract")
  if token_security.get("is_mintable") == "1":
    risk = max(risk, 0.4)
    flags.append("mintable")
  if not flags:
    flags.append("goplus_live_check_passed")

  return {"risk_score": risk, "flags": flags}
