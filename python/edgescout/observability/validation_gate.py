"""Validation gate for EdgeScout v2 pipelines, with Prometheus telemetry.

Decorator wrapper that validates a pipeline step's output before it
enters Pinecone or state memory: structural checks (dict + required
fields), domain checks (confidence in [0, 1], valuation within a
safety limit), low-confidence fallback flags, and Prometheus
counters/histograms. Works with or without ``prometheus_client``
installed — metrics are skipped gracefully when it is missing.

Usage (e.g. on the vision pricer node):

    from edgescout.observability.validation_gate import validate_pipeline_output

    @validate_pipeline_output(
        expected_fields=["item_id", "estimated_value", "confidence_score"],
        min_confidence=0.6,
        max_price_limit=10000.0,
    )
    def vision_pricer_node(state_payload: dict) -> dict:
        ...
"""

import logging
from functools import wraps
from typing import Any, Callable, Dict
import time

# Import Prometheus metrics client (pip install prometheus_client)
try:
    from prometheus_client import Counter, Histogram
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("EdgeScout.ValidationGate")

if PROMETHEUS_AVAILABLE:
    # Prometheus Metrics Definitions
    VALIDATION_REQUESTS = Counter(
        "edgescout_validation_requests_total",
        "Total validation checks executed",
        ["function_name", "status"]
    )
    VALIDATION_ERRORS = Counter(
        "edgescout_validation_errors_total",
        "Total validation errors caught by rule type",
        ["function_name", "error_type"]
    )
    LOW_CONFIDENCE_WARNINGS = Counter(
        "edgescout_low_confidence_total",
        "Total low-confidence outputs triggering fallback",
        ["function_name"]
    )
    VALIDATION_LATENCY = Histogram(
        "edgescout_validation_latency_seconds",
        "Time spent executing and validating pipeline step",
        ["function_name"]
    )

class ValidationError(Exception):
    """Raised when pipeline output violates schema or business rules."""
    pass

def validate_pipeline_output(
    expected_fields: list[str],
    min_confidence: float = 0.5,
    max_price_limit: float = 100000.0
):
    """
    Decorator wrapper for EdgeScout pipelines with integrated Prometheus telemetry.
    """
    def decorator(func: Callable[..., Dict[str, Any]]):
        func_name = func.__name__

        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()

            try:
                # 1. Execute pipeline function
                raw_output = func(*args, **kwargs)

                # 2. Structural Validation
                if not isinstance(raw_output, dict):
                    raise ValidationError("InvalidOutputType")

                missing = [f for f in expected_fields if f not in raw_output]
                if missing:
                    raise ValidationError("MissingMandatoryFields")

                # 3. Domain & Drift Checks
                confidence = raw_output.get("confidence_score", 0.0)
                if not (0.0 <= confidence <= 1.0):
                    raise ValidationError("ConfidenceOutOfBounds")

                if confidence < min_confidence:
                    if PROMETHEUS_AVAILABLE:
                        LOW_CONFIDENCE_WARNINGS.labels(function_name=func_name).inc()
                    logger.warning(f"Low confidence in {func_name}: {confidence}. Triggering fallback.")
                    raw_output["requires_fallback"] = True

                estimated_value = raw_output.get("estimated_value", 0.0)
                if not (0.0 <= estimated_value <= max_price_limit):
                    raise ValidationError("ValuationAnomalyLimitExceeded")

                # Record success metrics
                if PROMETHEUS_AVAILABLE:
                    VALIDATION_REQUESTS.labels(function_name=func_name, status="PASSED").inc()

                raw_output["validation_status"] = "PASSED"
                return raw_output

            except ValidationError as ve:
                err_type = str(ve)
                if PROMETHEUS_AVAILABLE:
                    VALIDATION_REQUESTS.labels(function_name=func_name, status="FAILED").inc()
                    VALIDATION_ERRORS.labels(function_name=func_name, error_type=err_type).inc()

                logger.error(f"Validation FAILED in {func_name} [{err_type}]")
                return {
                    "error": err_type,
                    "validation_status": "FAILED",
                    "requires_fallback": True,
                    "estimated_value": 0.0,
                    "confidence_score": 0.0
                }

            except Exception as e:
                if PROMETHEUS_AVAILABLE:
                    VALIDATION_REQUESTS.labels(function_name=func_name, status="ERROR").inc()
                    VALIDATION_ERRORS.labels(function_name=func_name, error_type="UnhandledException").inc()

                logger.error(f"Unexpected error in {func_name}: {str(e)}")
                return {
                    "error": str(e),
                    "validation_status": "ERROR",
                    "requires_fallback": True,
                    "estimated_value": 0.0,
                    "confidence_score": 0.0
                }

            finally:
                # Record latency histogram
                duration = time.time() - start_time
                if PROMETHEUS_AVAILABLE:
                    VALIDATION_LATENCY.labels(function_name=func_name).observe(duration)

        return wrapper
    return decorator
