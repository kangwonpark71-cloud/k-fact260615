# Security Rotation and History Cleanup

This project previously tracked deployment configuration values in `.env.production` and `wrangler.jsonc`. The current policy is to keep real environment values out of Git and to store only placeholders or examples in the repository.

## What Changed

- `.env.production` is ignored by Git and should remain local-only.
- `.env.example` documents required keys without values.
- `wrangler.jsonc` keeps Worker structure but uses placeholder values for project-specific vars.
- Secrets such as provider API keys, service-role keys, signing keys, and encryption keys must be configured outside Git.

## Rotation Checklist

Use this checklist if any committed value is considered sensitive by the project owner.

1. Rotate Supabase publishable/anon key if the project policy treats it as sensitive.
2. Rotate `SUPABASE_SERVICE_ROLE_KEY` immediately if it was ever committed, pasted, or logged.
3. Rotate AI provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.
4. Rotate evidence provider keys: `TAVILY_API_KEY`, `GOOGLE_FACTCHECK_API_KEY`, `NAVER_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `ECOS_API_KEY`, `KOSIS_API_KEY`.
5. Rotate `ENCRYPTION_KEY` and `RESULT_SIGNING_KEY` if production data signatures or encrypted API keys depend on exposed values.
6. Update Cloudflare Workers secrets/vars after rotation.
7. Redeploy the Worker only after local `bun run build` passes.
8. Verify Supabase RLS policies in the production project after deploy.

## Cloudflare Configuration

Recommended split:

- Keep non-secret placeholders in `wrangler.jsonc`.
- Store real deployment values in Cloudflare dashboard or environment-specific deployment automation.
- Store secrets with `wrangler secret put <NAME>`.

At minimum, configure these before production deploy:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put TAVILY_API_KEY
wrangler secret put ENCRYPTION_KEY
wrangler secret put RESULT_SIGNING_KEY
```

## Git History Cleanup

Do not rewrite public history casually. If the repository owner decides that historic values must be removed:

1. Rotate affected keys first.
2. Notify collaborators that history will be rewritten.
3. Use a dedicated cleanup branch or a fresh mirror clone.
4. Prefer `git filter-repo` over manual interactive rewrites for secret removal.
5. Force-push only with explicit owner approval.
6. Ask all collaborators to re-clone or hard-reset their local branches after cleanup.

If the exposed values are public identifiers only, history rewrite may not be worth the disruption. Rotation plus policy enforcement is usually safer.
