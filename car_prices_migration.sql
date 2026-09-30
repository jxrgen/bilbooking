-- Individuel km-pris pr. bil.
-- Kør én gang. Eksisterende biler får de satser, de allerede blev afregnet med.

ALTER TABLE cars ADD COLUMN IF NOT EXISTS price_km_low NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS price_km_high NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS price_km_threshold INTEGER;

UPDATE cars SET
  price_km_low = COALESCE(
    price_km_low,
    CASE
      WHEN lower(name) LIKE '%zoe%' OR lower(name) LIKE '%buzz%'
        THEN COALESCE((SELECT value::numeric FROM settings WHERE key = 'price_electric_low'), 2.5)
      ELSE COALESCE((SELECT value::numeric FROM settings WHERE key = 'price_standard_low'), 3.0)
    END
  ),
  price_km_high = COALESCE(
    price_km_high,
    CASE
      WHEN lower(name) LIKE '%zoe%' OR lower(name) LIKE '%buzz%'
        THEN COALESCE((SELECT value::numeric FROM settings WHERE key = 'price_electric_high'), 1.5)
      ELSE COALESCE((SELECT value::numeric FROM settings WHERE key = 'price_standard_high'), 2.0)
    END
  ),
  price_km_threshold = COALESCE(
    price_km_threshold,
    CASE
      WHEN lower(name) LIKE '%zoe%' OR lower(name) LIKE '%buzz%'
        THEN COALESCE((SELECT value::integer FROM settings WHERE key = 'price_electric_threshold'), 100)
      ELSE COALESCE((SELECT value::integer FROM settings WHERE key = 'price_standard_threshold'), 100)
    END
  );
