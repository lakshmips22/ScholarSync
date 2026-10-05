CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
    admin_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admins(admin_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin
    ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
    ON admin_sessions(expires_at);
