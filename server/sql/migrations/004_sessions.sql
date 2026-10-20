-- P7.5: one row per signed-in session (the JWT's jti), so a session can be revoked — on logout,
-- or everywhere at once — before its token expires.
-- @skip-if-table-exists sessions
CREATE TABLE sessions (
  jti         CHAR(36) PRIMARY KEY,
  user_id     INT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  revoked_at  TIMESTAMP NULL DEFAULT NULL,
  user_agent  VARCHAR(255) NULL,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
