-- Indstillinger — udvidelse af den eksisterende settings-tabel
-- Kør denne SQL i Supabase → SQL Editor → New query.
--
-- settings-tabellen findes allerede: (key text PRIMARY KEY, value text NOT NULL)
-- Denne migration giver admin-UI'en lov til at GEMME indstillinger (INSERT/UPDATE)
-- og indsætter standardværdier.
--
-- SIKKERHED: settings kan læses og skrives med appens offentlige nøgle.
--  - admin_password er beskyttet mod ændring via politikkerne nedenfor.
--  - SMTP-adgangskoden er læsbar med den offentlige nøgle — brug en DEDIKERET
--    afsender-konto med begrænsede rettigheder, ikke en privat mailadgangskode.

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Læsning (behold/genopret)
DROP POLICY IF EXISTS "anon kan læse settings" ON settings;
CREATE POLICY "anon kan læse settings" ON settings
  FOR SELECT USING (true);

-- Skrivning — men aldrig ændring af admin_password via den offentlige nøgle
DROP POLICY IF EXISTS "anon kan indsætte settings" ON settings;
CREATE POLICY "anon kan indsætte settings" ON settings
  FOR INSERT WITH CHECK (key <> 'admin_password');

DROP POLICY IF EXISTS "anon kan opdatere settings" ON settings;
CREATE POLICY "anon kan opdatere settings" ON settings
  FOR UPDATE USING (key <> 'admin_password')
  WITH CHECK (key <> 'admin_password');

-- Standardværdier (appen har egne fallback-defaults hvis rækker mangler)
INSERT INTO settings (key, value) VALUES
  ('price_standard_low',       '3.0'),
  ('price_standard_high',      '2.0'),
  ('price_standard_threshold', '100'),
  ('price_electric_low',       '2.5'),
  ('price_electric_high',      '1.5'),
  ('price_electric_threshold', '100'),
  ('price_hour',               '15'),
  ('price_day',                '150'),
  ('price_monthly_fee',        '75'),
  ('backup_frequency',         'monthly'),
  ('backup_email',             ''),
  ('smtp_host',                ''),
  ('smtp_port',                '587'),
  ('smtp_user',                ''),
  ('smtp_pass',                ''),
  ('smtp_from',                ''),
  ('watermark_enabled',        '0'),
  ('watermark_text',           'PRØVEVERSION'),
  ('club_name',                'Delebilsklub'),
  ('contact_email',            ''),
  ('booking_max_days',         '14')
ON CONFLICT (key) DO NOTHING;
