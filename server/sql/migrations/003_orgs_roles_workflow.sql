-- P7.4: organisations, memberships with roles, sharing a design with an organisation, the
-- draft → submitted → approved / rejected workflow with mandatory comments, and an audit log.
-- @skip-if-table-exists organisations
CREATE TABLE organisations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- @skip-if-table-exists memberships
CREATE TABLE memberships (
  user_id     INT NOT NULL,
  org_id      INT NOT NULL,
  role        ENUM('designer', 'reviewer', 'approver', 'admin') NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, org_id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memberships_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- @skip-if-column-exists designs.org_id
ALTER TABLE designs ADD COLUMN org_id INT NULL;
-- @skip-if-fk-exists designs.fk_designs_org
ALTER TABLE designs ADD CONSTRAINT fk_designs_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE SET NULL;
-- @skip-if-column-exists designs.status
ALTER TABLE designs ADD COLUMN status ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'draft';
-- @skip-if-column-exists designs.locked_version
ALTER TABLE designs ADD COLUMN locked_version INT NULL;
-- @skip-if-table-exists design_reviews
CREATE TABLE design_reviews (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  design_id   INT NOT NULL,
  version     INT NOT NULL,
  action      ENUM('submit', 'approve', 'reject') NOT NULL,
  comment     TEXT NOT NULL,
  user_id     INT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_design FOREIGN KEY (design_id) REFERENCES designs(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- @skip-if-table-exists audit_log
CREATE TABLE audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  org_id      INT NULL,
  design_id   INT NULL,
  version     INT NULL,
  action      VARCHAR(64) NOT NULL,
  detail      JSON NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_org (org_id, id),
  KEY idx_audit_design (design_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
