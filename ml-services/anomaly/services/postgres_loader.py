import os

import pandas as pd
import psycopg2


class PostgresLoader:

    def __init__(self):

        self.conn = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=os.getenv("POSTGRES_PORT", "5432"),
            database=os.getenv("POSTGRES_DB", "finintel"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", "postgres"),
        )

    def load_all_transactions(self):
        """All clean transactions across statements. sender_account is filled
        with the statement HOLDER account when the raw column is null (real
        single-account statements), so feature building covers them too."""
        query = """
        SELECT
            COALESCE(t.sender_account, s.account_number,
                     'STMT:' || t.statement_id::text) AS sender_account,
            t.receiver_account,
            t.amount,
            t.txn_type,
            t.date,
            t.statement_id
        FROM transactions t
        JOIN statements s ON s.id = t.statement_id
        WHERE t.is_valid = true
        """
        return pd.read_sql(query, self.conn)

    def load_latest_statement_transactions(
        self
    ):

        query = """
        SELECT
            t.sender_account,
            t.receiver_account,
            t.amount,
            t.txn_type,
            t.date,
            t.statement_id
        FROM transactions t

        WHERE t.statement_id = (

            SELECT id
            FROM statements
            ORDER BY upload_time DESC
            LIMIT 1

        )

        AND t.is_valid = true
        AND t.sender_account IS NOT NULL
        """

        return pd.read_sql(
            query,
            self.conn
        )

    def load_statement_transactions(
        self,
        statement_id
    ):

        query = """
        SELECT
            sender_account,
            receiver_account,
            amount,
            txn_type,
            date,
            statement_id
        FROM transactions

        WHERE statement_id = %s

        AND is_valid = true
        AND sender_account IS NOT NULL
        """

        return pd.read_sql(
            query,
            self.conn,
            params=[statement_id]
        )

    def load_account_transactions(
        self,
        account
    ):

        query = """
        SELECT
            sender_account,
            receiver_account,
            amount,
            txn_type,
            date,
            statement_id
        FROM transactions

        WHERE
            sender_account = %s
            OR
            receiver_account = %s

        AND is_valid = true
        """

        return pd.read_sql(
            query,
            self.conn,
            params=[
                account,
                account
            ]
        )
