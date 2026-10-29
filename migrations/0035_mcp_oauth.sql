CREATE TABLE mcp_oauth_clients (
 id text PRIMARY KEY, metadata jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE mcp_oauth_requests (
 hash text PRIMARY KEY, client_id text NOT NULL REFERENCES mcp_oauth_clients(id),
 params jsonb NOT NULL, user_id varchar REFERENCES users(id) ON DELETE CASCADE,
 csrf_hash text, consented_at timestamp, used_at timestamp, expires_at timestamp NOT NULL
);
CREATE TABLE mcp_oauth_grants (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES mcp_oauth_clients(id),
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
 scopes jsonb NOT NULL, resource text NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
 expires_at timestamp NOT NULL, revoked_at timestamp
);
CREATE INDEX mcp_oauth_grants_owner_idx ON mcp_oauth_grants(user_id);
CREATE TABLE mcp_oauth_codes (
 hash text PRIMARY KEY, grant_id varchar NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
 redirect_uri text NOT NULL, code_challenge text NOT NULL, expires_at timestamp NOT NULL, used_at timestamp
);
CREATE TABLE mcp_oauth_tokens (
 hash text PRIMARY KEY, grant_id varchar NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('access','refresh')), expires_at timestamp NOT NULL, used_at timestamp
);
CREATE INDEX mcp_oauth_tokens_grant_idx ON mcp_oauth_tokens(grant_id);
CREATE TABLE mcp_oauth_audit (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar, client_id text, grant_id varchar,
 action text NOT NULL, outcome text NOT NULL, tool text, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX mcp_oauth_audit_owner_time_idx ON mcp_oauth_audit(user_id, created_at);
