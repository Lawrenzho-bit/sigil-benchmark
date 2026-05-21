-- 003_portal_auth.sql — credentials for the customer web portal.
-- Customers who only ever email support never set a password; the column is
-- nullable and only populated when they register on the portal.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_password_hash TEXT;
