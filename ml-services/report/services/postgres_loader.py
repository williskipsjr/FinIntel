"""DB aggregates for investigation reports."""

import os
import psycopg2
from psycopg2.extras import RealDictCursor


def _conn():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        database=os.getenv("POSTGRES_DB", "finintel"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "postgres"),
    )


def _one(query, params=None):
    with _conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params or [])
            return dict(cur.fetchone())


def _all(query, params=None):
    with _conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params or [])
            return [dict(r) for r in cur.fetchall()]


class PostgresLoader:

    def summary_counts(self, statement_id=None):
        if statement_id:
            return _one(
                """
                SELECT
                  1 AS statements,
                  (SELECT COUNT(*) FROM transactions
                     WHERE statement_id = %(sid)s::uuid) AS transactions,
                  (SELECT COUNT(*) FROM entities) AS entities,
                  (SELECT COUNT(*) FROM transactions
                     WHERE statement_id = %(sid)s::uuid AND is_duplicate) AS duplicates,
                  (SELECT COUNT(*) FROM transactions
                     WHERE statement_id = %(sid)s::uuid AND is_failed) AS failed,
                  (SELECT COALESCE(SUM(amount),0)::float8 FROM transactions
                     WHERE statement_id = %(sid)s::uuid AND debit_credit='CREDIT') AS total_credit,
                  (SELECT COALESCE(SUM(amount),0)::float8 FROM transactions
                     WHERE statement_id = %(sid)s::uuid AND debit_credit='DEBIT') AS total_debit
                """,
                {"sid": statement_id},
            )
        return _one(
            """
            SELECT
              (SELECT COUNT(*) FROM statements)   AS statements,
              (SELECT COUNT(*) FROM transactions) AS transactions,
              (SELECT COUNT(*) FROM entities)     AS entities,
              (SELECT COUNT(*) FROM transactions WHERE is_duplicate) AS duplicates,
              (SELECT COUNT(*) FROM transactions WHERE is_failed)    AS failed,
              (SELECT COALESCE(SUM(amount),0)::float8 FROM transactions
                 WHERE debit_credit='CREDIT') AS total_credit,
              (SELECT COALESCE(SUM(amount),0)::float8 FROM transactions
                 WHERE debit_credit='DEBIT')  AS total_debit
            """
        )

    def validation_summary(self, statement_id=None):
        if statement_id:
            return _one(
                """
                SELECT
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE is_duplicate) AS duplicates,
                  COUNT(*) FILTER (WHERE is_failed) AS failed,
                  COUNT(*) FILTER (WHERE NOT is_valid) AS invalid,
                  AVG(confidence_score)::float8 AS average_confidence
                FROM transactions WHERE statement_id = %(sid)s::uuid
                """,
                {"sid": statement_id},
            )
        return _one(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE is_duplicate) AS duplicates,
              COUNT(*) FILTER (WHERE is_failed) AS failed,
              COUNT(*) FILTER (WHERE NOT is_valid) AS invalid,
              AVG(confidence_score)::float8 AS average_confidence
            FROM transactions
            """
        )

    def top_entities(self, limit=25):
        return _all(
            """
            SELECT entity_type, identifier, display_name
            FROM entities
            ORDER BY entity_type, identifier
            LIMIT %s
            """,
            [limit],
        )

    def statement_identities(self):
        """Per-statement human-friendly identifiers so the report can show an
        account number / file name instead of an opaque statement UUID."""
        return _all(
            """
            SELECT id::text AS id, filename, account_number,
                   account_holder, bank_name
            FROM statements
            """
        )

    def transactions_full(self, statement_id):
        """Full ledger detail for a statement's transactions, keyed for the
        money-trail bank report (date, time, narration, reference, dr/cr, balance)."""
        if not statement_id:
            return []
        return _all(
            """
            SELECT t.id::text AS id, t.date::text AS date, t.time,
                   t.narration, t.reference_number, t.debit_credit,
                   t.amount, t.balance
            FROM transactions t
            WHERE t.statement_id = %s::uuid
            """,
            [statement_id],
        )

    def all_statement_ids(self):
        rows = _all(
            """
            SELECT DISTINCT t.statement_id::text AS sid
            FROM transactions t
            WHERE t.is_valid = true
              AND (t.is_duplicate = false OR t.is_duplicate IS NULL)
            """
        )
        return [r["sid"] for r in rows if r.get("sid")]

    def transactions_for_analytics(self, statement_id=None):
        """Lightweight per-transaction rows for channel / category / velocity
        analytics: narration, txn_type, platform, direction, amount, date,
        failed flag. Whole-network when statement_id is None."""
        clauses = ["(t.is_duplicate = false OR t.is_duplicate IS NULL)"]
        params = []
        if statement_id:
            clauses.append("t.statement_id = %s::uuid")
            params.append(statement_id)
        where = " AND ".join(clauses)
        return _all(
            f"""
            SELECT t.date::text AS date, t.narration, t.txn_type, t.platform,
                   t.debit_credit, t.amount::float8 AS amount,
                   COALESCE(t.is_failed, false) AS is_failed
            FROM transactions t
            WHERE {where}
            ORDER BY t.date NULLS LAST
            """,
            params,
        )

    def cash_transactions(self, statement_id=None, limit=200):
        """ATM / cash-marked transactions (narration + amount + date/time) so the
        report builder can attach a physical withdrawal/deposit location."""
        clauses = [
            "t.is_valid = true",
            "(t.is_duplicate = false OR t.is_duplicate IS NULL)",
            "(upper(t.narration) LIKE '%%ATM%%' OR upper(t.narration) LIKE '%%CASH%%'"
            " OR upper(t.narration) LIKE '%%WDL%%' OR upper(t.narration) LIKE '%%NFS%%')",
        ]
        params = []
        if statement_id:
            clauses.append("t.statement_id = %s::uuid")
            params.append(statement_id)
        where = " AND ".join(clauses)
        return _all(
            f"""
            SELECT t.date::text AS date, t.time, t.amount, t.debit_credit, t.narration
            FROM transactions t
            WHERE {where}
            ORDER BY t.date NULLS LAST, t.time NULLS LAST
            LIMIT {int(limit)}
            """,
            params,
        )
