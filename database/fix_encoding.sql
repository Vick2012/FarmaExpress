-- Repara texto con doble codificación UTF-8 (aparece como "Ã³" en vez de "ó",
-- "Ã©" en vez de "é", etc.) causado por haber corrido schema.sql / seed_farmaexpress.sql
-- con client_encoding distinto de UTF8.
--
-- Ejecutar UNA sola vez, después de aplicar el fix en schema.sql/seed_farmaexpress.sql:
--   psql -U postgres -d farmaexpress -f database/fix_encoding.sql
--
-- Es seguro correrlo varias veces: solo toca las columnas que todavía contienen
-- el byte de corrupción (chr(195) = 'Ã'), así que una vez reparado no vuelve a tocar nada.

SET client_encoding = 'UTF8';

BEGIN;

UPDATE categories
SET
  name = CASE WHEN name LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(name, 'LATIN1'), 'UTF8') ELSE name END,
  description = CASE WHEN description LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(description, 'LATIN1'), 'UTF8') ELSE description END
WHERE name LIKE '%' || chr(195) || '%' OR description LIKE '%' || chr(195) || '%';

UPDATE products
SET
  name = CASE WHEN name LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(name, 'LATIN1'), 'UTF8') ELSE name END,
  brand = CASE WHEN brand LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(brand, 'LATIN1'), 'UTF8') ELSE brand END
WHERE name LIKE '%' || chr(195) || '%' OR brand LIKE '%' || chr(195) || '%';

UPDATE customers
SET
  full_name = CASE WHEN full_name LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(full_name, 'LATIN1'), 'UTF8') ELSE full_name END,
  address = CASE WHEN address LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(address, 'LATIN1'), 'UTF8') ELSE address END
WHERE full_name LIKE '%' || chr(195) || '%' OR address LIKE '%' || chr(195) || '%';

UPDATE suppliers
SET
  name = CASE WHEN name LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(name, 'LATIN1'), 'UTF8') ELSE name END,
  contact_name = CASE WHEN contact_name LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(contact_name, 'LATIN1'), 'UTF8') ELSE contact_name END,
  address = CASE WHEN address LIKE '%' || chr(195) || '%'
    THEN convert_from(convert_to(address, 'LATIN1'), 'UTF8') ELSE address END
WHERE name LIKE '%' || chr(195) || '%'
   OR contact_name LIKE '%' || chr(195) || '%'
   OR address LIKE '%' || chr(195) || '%';

COMMIT;
