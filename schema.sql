-- Bilbooking - Supabase Schema
-- Kør denne SQL i Supabase SQL Editor (Database → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS cars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#4A90D9',
  current_km INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  car_id UUID REFERENCES cars(id) ON DELETE CASCADE NOT NULL,
  user_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  expected_km INTEGER NOT NULL DEFAULT 0,
  start_km INTEGER NOT NULL DEFAULT 0,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT no_end_before_start CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  car_id UUID REFERENCES cars(id) ON DELETE CASCADE NOT NULL,
  start_km INTEGER NOT NULL,
  end_km INTEGER NOT NULL,
  km_driven INTEGER GENERATED ALWAYS AS (end_km - start_km) STORED,
  duration_quarters INTEGER NOT NULL,
  comments TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT positive_km CHECK (end_km >= start_km)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action_type TEXT NOT NULL,
  car_id UUID REFERENCES cars(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  user_name TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tillad anonym adgang (ingen login krævet)
ALTER TABLE cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access" ON cars FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON bookings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON deliveries FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON activity_log FOR ALL TO anon USING (true) WITH CHECK (true);

-- Indsæt de 4 biler (mættede, stærke farver)
INSERT INTO cars (name, color, current_km) VALUES
  ('ID3',          '#1D4ED8', 0),
  ('Renault Zoe',  '#047857', 0),
  ('Berlingo',     '#B45309', 0),
  ('ID Buzz',      '#6D28D9', 0);

-- Hvis du allerede har kørt skemaet og vil opdatere farverne:
-- UPDATE cars SET color = '#1D4ED8' WHERE name = 'ID3';
-- UPDATE cars SET color = '#047857' WHERE name = 'Renault Zoe';
-- UPDATE cars SET color = '#B45309' WHERE name = 'Berlingo';
-- UPDATE cars SET color = '#6D28D9' WHERE name = 'ID Buzz';

-- ============================================================
-- CHARGING SYSTEM (Smart Charger with SIM-card)
-- ============================================================

CREATE TABLE IF NOT EXISTS chargers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  location TEXT,
  sim_id TEXT UNIQUE,
  model TEXT,
  max_power_kw NUMERIC DEFAULT 11,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charging_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  car_id UUID REFERENCES cars(id) ON DELETE SET NULL,
  charger_id UUID REFERENCES chargers(id) ON DELETE SET NULL,
  user_name TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  energy_consumed_kwh NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charging_telemetry (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  charging_session_id UUID REFERENCES charging_sessions(id) ON DELETE CASCADE,
  charger_id UUID REFERENCES chargers(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT now(),
  voltage_v NUMERIC,
  current_a NUMERIC,
  power_kw NUMERIC,
  temperature_c NUMERIC,
  cumulative_kwh NUMERIC DEFAULT 0
);

ALTER TABLE chargers ENABLE ROW LEVEL SECURITY;
ALTER TABLE charging_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE charging_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access" ON chargers FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON charging_sessions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON charging_telemetry FOR ALL TO anon USING (true) WITH CHECK (true);

-- Insert sample chargers for testing/simulation
INSERT INTO chargers (name, location, max_power_kw) VALUES
  ('Lader 1 - Indgang A', 'Parkering vest', 11),
  ('Lader 2 - Indgang B', 'Parkering øst', 22),
  ('Lader 3 - Garage', 'Indendørs', 7);

