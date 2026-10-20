-- P7.3: every save of a design is kept as a numbered version.
-- @skip-if-table-exists design_versions
CREATE TABLE design_versions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  design_id   INT NOT NULL,
  version     INT NOT NULL,
  data        JSON NOT NULL,
  note        VARCHAR(500) NULL,
  created_by  INT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_design_version (design_id, version),
  CONSTRAINT fk_versions_design FOREIGN KEY (design_id) REFERENCES designs(id) ON DELETE CASCADE,
  CONSTRAINT fk_versions_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- @skip-if-column-exists designs.current_version
ALTER TABLE designs ADD COLUMN current_version INT NOT NULL DEFAULT 0;
-- Designs saved before versioning become version 1 of themselves.
INSERT INTO design_versions (design_id, version, data, note, created_by)
  SELECT d.id, 1, d.data, 'Saved before version history existed', d.user_id FROM designs d
  WHERE d.current_version = 0 AND NOT EXISTS (SELECT 1 FROM design_versions v WHERE v.design_id = d.id);
UPDATE designs SET current_version = 1 WHERE current_version = 0;
