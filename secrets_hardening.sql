-- Skjul mail- og admin-koden for den offentlige rolle.
-- Mail-tjenesten læser SMTP via rollen mailer. Admin-login svarer kun ja eller nej.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mailer') THEN
    CREATE ROLE mailer NOLOGIN;
  END IF;
END $$;

GRANT mailer TO authenticator;
GRANT SELECT ON settings TO mailer;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_anon_select ON settings;
CREATE POLICY settings_anon_select ON settings
  FOR SELECT TO web_anon
  USING (key <> 'smtp_pass' AND key <> 'admin_password');

DROP POLICY IF EXISTS settings_anon_insert ON settings;
CREATE POLICY settings_anon_insert ON settings
  FOR INSERT TO web_anon
  WITH CHECK (key <> 'admin_password');

DROP POLICY IF EXISTS settings_anon_update ON settings;
CREATE POLICY settings_anon_update ON settings
  FOR UPDATE TO web_anon
  USING (key <> 'admin_password')
  WITH CHECK (key <> 'admin_password');

DROP POLICY IF EXISTS settings_anon_delete ON settings;
CREATE POLICY settings_anon_delete ON settings
  FOR DELETE TO web_anon
  USING (key <> 'admin_password');

DROP POLICY IF EXISTS settings_mailer_select ON settings;
CREATE POLICY settings_mailer_select ON settings
  FOR SELECT TO mailer
  USING (true);

CREATE OR REPLACE FUNCTION public.check_admin_password(password text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM settings
    WHERE key = 'admin_password' AND value = password
  );
$$;

CREATE OR REPLACE FUNCTION public.set_admin_password(current_password text, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF new_password IS NULL OR length(btrim(new_password)) = 0 THEN
    RAISE EXCEPTION 'Adgangskoden må ikke være tom';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM settings
    WHERE key = 'admin_password' AND value = current_password
  ) THEN
    RAISE EXCEPTION 'Nuværende adgangskode er forkert';
  END IF;
  INSERT INTO settings (key, value)
  VALUES ('admin_password', btrim(new_password))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

DROP FUNCTION IF EXISTS public.set_admin_password(text);

REVOKE ALL ON FUNCTION public.check_admin_password(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_admin_password(text) TO web_anon;
GRANT EXECUTE ON FUNCTION public.set_admin_password(text, text) TO web_anon;
