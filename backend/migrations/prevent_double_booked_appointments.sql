-- Prevent two active appointments from being booked at the same timestamp.
-- Cancelled appointments are excluded so their former slots can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_booked_time_unique
ON public.appointments(appointment_time)
WHERE status = 'booked';

