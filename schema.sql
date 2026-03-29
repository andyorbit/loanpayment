-- Loan Payment Tracker Schema

CREATE TABLE IF NOT EXISTS loan_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    original_amount REAL NOT NULL,
    start_date TEXT NOT NULL,
    annual_rate REAL NOT NULL,
    currency_symbol TEXT DEFAULT '£',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    payment_date TEXT NOT NULL,
    note TEXT,
    status TEXT DEFAULT 'pending',
    validated_at TEXT,
    validation_source TEXT,
    monzo_match_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interest_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    balance_before REAL NOT NULL,
    interest_amount REAL NOT NULL,
    balance_after REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    effective_date TEXT NOT NULL,
    old_rate REAL NOT NULL,
    new_rate REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    password_hash TEXT NOT NULL,
    theme TEXT DEFAULT 'light'
);

CREATE TABLE IF NOT EXISTS monzo_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    google_sheet_id TEXT,
    sheet_name TEXT DEFAULT 'Personal Account Transactions',
    last_sync_at TEXT,
    sync_interval_minutes INTEGER DEFAULT 30
);

CREATE TABLE IF NOT EXISTS monzo_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    name_pattern TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Seed loan config
INSERT OR IGNORE INTO loan_config (id, original_amount, start_date, annual_rate) VALUES (1, 7000.00, '2026-03-17', 0.07);
