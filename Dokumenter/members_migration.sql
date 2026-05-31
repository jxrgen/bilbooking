-- Members table migration for bilbooking
-- Run this in the Supabase Dashboard SQL editor

CREATE TABLE IF NOT EXISTS members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  navn TEXT NOT NULL,
  adresse TEXT,
  bogruppe TEXT,
  telefon TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_members" ON members FOR SELECT USING (true);
CREATE POLICY "anon_insert_members" ON members FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_members" ON members FOR UPDATE USING (true);
CREATE POLICY "anon_delete_members" ON members FOR DELETE USING (true);

-- Insert all 43 members (from medlemsliste_240510.csv)
INSERT INTO members (navn, adresse, bogruppe, telefon) VALUES
  ('Aksel Striim', 'Hj. Møllevej 138', '4', '52444333'),
  ('Alexandra Hasdorf', 'Hj. Møllevej 174', '2', '25306626'),
  ('Anke Stubsgaard', 'Gl. Kirkevej 46', '1', '26157769'),
  ('Ann-Charlotte Knudsen', 'Hj Møllevej 98', '4', '87430083'),
  ('Anne Dalsgaard', 'Gl. Kirkevej 74', '3', '50539585'),
  ('Anne Sofie Larsen', 'Østergårdstoften 3', '5', '28435037'),
  ('Ann-Katrine Friis', 'Gl. Kirkevej 146', '8', '20785936'),
  ('Birte Moksha', 'Østergårdstoften 9', '5', '21294570'),
  ('Bodil Dahl Jensen', 'Gl. Kirkevej 38', '1', '61779902'),
  ('Christian Brink', 'Hj. Møllevej 35', 'Ekstern', '26184405'),
  ('Christina Adolph', 'Gl. Kirkevej 46B', '1', '61666218'),
  ('Else Mikel Jensen', 'Gl. Kirkevej 150', '8', '61688486'),
  ('Grethe Thomsen', 'Østergårdstoften 27', '5', '40341558'),
  ('Gunnar Olesen', 'Gl. Kirkevej 72', '3', '24269933'),
  ('Henrik Hermind', 'Østergårdstoften 27', '5', '23982538'),
  ('Henrik Kjærsgaard', 'Gl. Kirkevej 38', '1', '28939873'),
  ('Ina Graneberg', 'Hj. Møllevej 164', '2', '30297633'),
  ('Jon Lehner', 'Gl. Kirkevej 124', '5', '28747364'),
  ('Jonathan Carl', 'Gl. Kirkevej 52', '1', '27618563'),
  ('Jørgen Holm', 'Gl. Kirkevej 62', '3', '42520000'),
  ('Jørn Heckmann', 'Hj. Møllevej 156', '2', '22958095'),
  ('Kasper Friis', 'Gl. Kirkevej 146', '8', '29661178'),
  ('Landbrug', '-', '-', '12345678'),
  ('Leif Lüdemann', 'Hj. Møllevej 144', '4', '40352158'),
  ('Margrete Madsen', 'Gl. Kirkevej 45', 'Ekstern', '28715699'),
  ('Marie Lottrup', 'Gl. Kirkevej 124', '5', '26360166'),
  ('Mathilde Vendelboe Andersen', 'Hj. Møllevej 49', 'Ekstern', '61776008'),
  ('Mikael Hermansson', 'Hj. Møllevej 150', '2', '30112456'),
  ('Morten Pedersen', 'Østergårdstoften 3', '5', '29821844'),
  ('Pernille Stentoft', 'Gl. Kirkevej 142', '7', '26121402'),
  ('Pierre Lecuelle', 'Gl. Kirkevej 46', '1', '60157769'),
  ('Preben Stentoft', 'Gl. Kirkevej 142', '7', '28352402'),
  ('Randi Pisani + Jørgen', 'Gl. Kirkevej 62', '3', '40626926'),
  ('Rasmus Ejrnæs', 'Gl. Kirkevej 74', '3', '20205829'),
  ('Service', '-', '-', '12345678'),
  ('Simon Jeppesen', 'Hj. Møllevej 180', '2', '26284474'),
  ('Simon Larsen', 'Gl. Kirkevej 45', 'Ekstern', '21601862'),
  ('Soffi Olesen', 'Gl. Kirkevej 72', '3', '28777192'),
  ('Sophie Vinther Andersen', 'Gl. Kirkevej 136', '7', '61608180'),
  ('Søren Egge Rasmussen', 'Hj Møllevej 162', '2', '61624543'),
  ('Ulla Carl', 'Gl. Kirkevej 52', '1', '60273366'),
  ('Aase Ehlert Holt', 'Hj. Møllevej 160', '2', '28389491');
