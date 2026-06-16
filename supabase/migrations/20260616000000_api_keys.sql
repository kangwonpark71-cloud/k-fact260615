CREATE TABLE public.api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  key_value TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_provider_active ON public.api_keys(provider, is_active, created_at DESC);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.api_keys TO service_role;
