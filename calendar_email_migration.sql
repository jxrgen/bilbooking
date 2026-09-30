-- Mail på medlemmet, og skift af admin-adgangskode fra Indstillinger.
-- Kør i databasens SQL-editor (én gang).

ALTER TABLE members ADD COLUMN IF NOT EXISTS email TEXT;

CREATE OR REPLACE FUNCTION set_admin_password(new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new_password IS NULL OR length(btrim(new_password)) = 0 THEN
    RAISE EXCEPTION 'Adgangskoden må ikke være tom';
  END IF;
  INSERT INTO settings (key, value)
  VALUES ('admin_password', btrim(new_password))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_anon') THEN
    GRANT EXECUTE ON FUNCTION set_admin_password(text) TO web_anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION set_admin_password(text) TO anon;
  END IF;
END $$;
