-- Afvis nye tidsoverlap på samme bil. Allerede gemte overlap kan
-- beholdes, så længe tidsrummet ikke ændres.

CREATE OR REPLACE FUNCTION bookings_reject_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.car_id IS NOT DISTINCT FROM NEW.car_id
     AND OLD.start_time IS NOT DISTINCT FROM NEW.start_time
     AND OLD.end_time IS NOT DISTINCT FROM NEW.end_time
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE car_id = NEW.car_id
      AND id <> NEW.id
      AND status <> 'cancelled'
      AND tstzrange(start_time, end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'Bilen er allerede booket i dette tidsrum.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_no_overlap ON bookings;
CREATE TRIGGER bookings_no_overlap
  BEFORE INSERT OR UPDATE OF start_time, end_time, car_id, status
  ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION bookings_reject_overlap();
