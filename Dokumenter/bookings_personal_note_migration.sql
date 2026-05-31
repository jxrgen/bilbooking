-- Add personal_note column to bookings table
-- Run this in the Supabase Dashboard SQL editor

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS personal_note TEXT;
