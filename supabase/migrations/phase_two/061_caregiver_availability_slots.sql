-- Caregiver self-service availability (My Calendar): recurring weekly or one-off date ranges.

CREATE TABLE IF NOT EXISTS public.caregiver_availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_member_id uuid NOT NULL REFERENCES public.caregiver_members (id) ON DELETE CASCADE,
  agency_id uuid REFERENCES public.agencies (id) ON DELETE SET NULL,
  label text,
  is_recurring boolean NOT NULL DEFAULT false,
  start_time time NOT NULL,
  end_time time NOT NULL,
  repeat_frequency text,
  days_of_week smallint[],
  repeat_start date,
  repeat_end date,
  specific_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caregiver_availability_slots_recurring_chk CHECK (
    (is_recurring = false AND specific_date IS NOT NULL AND days_of_week IS NULL)
    OR
    (is_recurring = true AND repeat_start IS NOT NULL AND days_of_week IS NOT NULL AND cardinality(days_of_week) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_caregiver_availability_slots_member
  ON public.caregiver_availability_slots (caregiver_member_id);

COMMENT ON TABLE public.caregiver_availability_slots IS
  'Caregiver availability windows for matching; times are local wall-clock (time without TZ).';
COMMENT ON COLUMN public.caregiver_availability_slots.days_of_week IS
  '0=Sunday … 6=Saturday (JavaScript Date.getDay()).';

DROP TRIGGER IF EXISTS trg_caregiver_availability_slots_updated_at ON public.caregiver_availability_slots;
CREATE TRIGGER trg_caregiver_availability_slots_updated_at
  BEFORE UPDATE ON public.caregiver_availability_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.caregiver_availability_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caregiver_availability_slots_select_own"
  ON public.caregiver_availability_slots
  FOR SELECT
  TO authenticated
  USING (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
  );

CREATE POLICY "caregiver_availability_slots_insert_own"
  ON public.caregiver_availability_slots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
    AND (
      agency_id IS NULL
      OR agency_id IN (
        SELECT cm.agency_id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "caregiver_availability_slots_update_own"
  ON public.caregiver_availability_slots
  FOR UPDATE
  TO authenticated
  USING (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
    AND (
      agency_id IS NULL
      OR agency_id IN (
        SELECT cm.agency_id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "caregiver_availability_slots_delete_own"
  ON public.caregiver_availability_slots
  FOR DELETE
  TO authenticated
  USING (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
  );
