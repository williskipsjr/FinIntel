CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS statements (
    id UUID PRIMARY KEY,
    filename TEXT NOT NULL,
    bank_name TEXT,
    upload_time TIMESTAMP DEFAULT NOW(),
    status TEXT NOT NULL,
    file_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    statement_id UUID REFERENCES statements(id),
    date DATE,
    sender_account TEXT,
    receiver_account TEXT,
    amount DECIMAL(15,2),
    txn_type TEXT,
    upi_id TEXT,
    narration TEXT,
    narration_normalized TEXT,
    balance DECIMAL(15,2),
    bank_name TEXT,
    raw_row JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY,
    entity_type TEXT,
    identifier TEXT UNIQUE,
    display_name TEXT,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS risk_profiles (
    entity_id UUID REFERENCES entities(id),
    rule_score FLOAT,
    stat_score FLOAT,
    temporal_score FLOAT,
    graph_score FLOAT,
    gnn_score FLOAT,
    final_score FLOAT,
    risk_level TEXT,
    patterns JSONB,
    computed_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_number TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS debit_credit TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_failed BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_valid BOOLEAN DEFAULT TRUE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confidence_score FLOAT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS validation_notes JSONB;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS time TEXT;

ALTER TABLE statements ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS account_holder TEXT;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(15,2);
ALTER TABLE statements ADD COLUMN IF NOT EXISTS closing_balance NUMERIC(15,2);
ALTER TABLE statements ADD COLUMN IF NOT EXISTS statement_start_date DATE;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS statement_end_date DATE;

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    statement_id UUID REFERENCES statements(id),
    status TEXT NOT NULL DEFAULT 'queued',
    progress INT NOT NULL DEFAULT 0,
    stage TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_statement ON jobs(statement_id);

CREATE TABLE IF NOT EXISTS analysis_cache (
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (scope, kind)
);

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    statement_id UUID REFERENCES statements(id),
    account TEXT,
    severity TEXT NOT NULL,
    category TEXT,
    title TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    acknowledged BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_statement ON alerts(statement_id);
