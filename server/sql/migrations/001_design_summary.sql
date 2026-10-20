-- P6.5: a compact result summary per design (computed by the client on save) for the fleet
-- dashboard, and when it was last refreshed.
-- @skip-if-column-exists designs.summary
ALTER TABLE designs ADD COLUMN summary JSON NULL;
-- @skip-if-column-exists designs.summary_updated_at
ALTER TABLE designs ADD COLUMN summary_updated_at TIMESTAMP NULL DEFAULT NULL;
