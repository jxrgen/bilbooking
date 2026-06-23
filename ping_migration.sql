-- Ping migration: Keep project active on Supabase Free tier
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ping_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pinged_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for consistency
ALTER TABLE ping_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access" ON ping_log FOR ALL TO anon USING (true) WITH CHECK (true);

-- RPC function for pinging
CREATE OR REPLACE FUNCTION ping_keep_alive()
RETURNS JSON AS $$
BEGIN
  INSERT INTO ping_log (pinged_at) VALUES (now());
  RETURN json_build_object('status', 'pong', 'timestamp', now());
END;
$$ LANGUAGE plpgsql;
