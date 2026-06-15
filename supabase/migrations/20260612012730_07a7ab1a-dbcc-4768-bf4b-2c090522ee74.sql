
CREATE POLICY "Block updates via API"
  ON public.analyses FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Block deletes via API"
  ON public.analyses FOR DELETE
  TO authenticated, anon
  USING (false);
