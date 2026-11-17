"""Durable Postgres checkpointing for the EdgeScout LangGraph.

Why this file exists: the naive pattern floating around the notes —

    with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
        app = workflow.compile(checkpointer=checkpointer)
        return app

— is broken. The ``with`` block closes the connection as soon as the
function returns, so the compiled app you get back has a dead
checkpointer. Use a connection pool that stays open for the life of
the app instead, and close it on shutdown.

Setup:
    export DATABASE_URL="postgresql://langgraph_app:<password>@<host>:5432/langgraph"
    pip install -r requirements.txt

``checkpointer.setup()`` creates the checkpoint tables; it only needs
to run once per database (it is safe to run again — tables are
created IF NOT EXISTS — but there is no reason to run it on every
start in production).
"""

import os
from typing import Optional, Tuple

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .graph import build_edgescout_workflow


def build_durable_edgescout_graph(
    db_uri: Optional[str] = None,
    pool_size: int = 20,
    run_setup: bool = True,
):
    """Compile the EdgeScout graph against a durable Postgres checkpointer.

    Returns ``(app, pool)`` — keep ``pool`` open while the app runs
    and call ``pool.close()`` on shutdown.

    Args:
        db_uri: Postgres connection string. Defaults to the
            ``DATABASE_URL`` environment variable. Never hard-code
            credentials — pull them from the environment in production.
        pool_size: Max connections in the pool.
        run_setup: Create checkpoint tables if they do not exist.
            Only needed the first time a database is used.
    """
    db_uri = db_uri or os.getenv("DATABASE_URL")
    if not db_uri:
        raise ValueError(
            "No Postgres URI: pass db_uri or set the DATABASE_URL "
            "environment variable."
        )

    connection_kwargs = {
        "autocommit": True,
        "row_factory": dict_row,
    }

    pool = ConnectionPool(
        conninfo=db_uri,
        max_size=pool_size,
        kwargs=connection_kwargs,
    )
    checkpointer = PostgresSaver(pool)
    if run_setup:
        checkpointer.setup()

    app = build_edgescout_workflow().compile(checkpointer=checkpointer)
    return app, pool


def run_durable_example(db_uri: Optional[str] = None):
    """Minimal end-to-end run against Postgres (mobile session key as thread_id)."""
    app, pool = build_durable_edgescout_graph(db_uri=db_uri)
    try:
        # Thread IDs as mobile session keys: always pass a unique
        # thread_id tied to the user's mobile session or asset lookup.
        # Must be under 255 chars.
        config = {
            "configurable": {
                "thread_id": "mobile_session_darkone.x_094"
            }
        }
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
    finally:
        pool.close()


if __name__ == "__main__":
    run_durable_example()
