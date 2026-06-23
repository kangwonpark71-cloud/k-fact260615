# Release and Remote Sync Checklist

Use this checklist before pushing local hardening work to the remote repository.

## Required Local Checks

```bash
bunx prettier --check . --ignore-unknown
bun run lint
bunx tsc --noEmit
bun run test
bun run build
git ls-files .env.production
git check-ignore .env.production
```

Expected results:

- Prettier passes.
- ESLint has no errors. Fast Refresh warnings are non-blocking unless the team chooses to split those modules.
- TypeScript passes.
- Tests pass.
- Build passes.
- `git ls-files .env.production` prints nothing.
- `git check-ignore .env.production` prints `.env.production`.

## Suggested Atomic Commit Plan

Follow the repository's existing semantic commit style.

1. `docs: 운영 문서와 보안 체크리스트 추가`
   - `README.md`
   - `.env.example`
   - `docs/security-rotation.md`
   - `docs/release-checklist.md`

2. `chore: 환경 파일 추적 정책 정리`
   - `.gitignore`
   - `.gitattributes`
   - `.prettierrc`
   - `.env.production` removed from Git index
   - `wrangler.jsonc`

3. `style: 프로젝트 포맷 정규화`
   - Prettier-only changes across existing source/config files

4. `test: Web Speech 경계 테스트 추가`
   - `src/lib/web-speech.test.ts`
   - `src/lib/web-speech.ts`

5. `fix: 음성 입력과 서버 함수 타입 안정화`
   - `src/components/VoiceInput.tsx`
   - `src/routes/live.tsx`
   - `src/routes/index.tsx`
   - server function validator migration files
   - safe JSON parsing/type cleanup files

## Remote Push Policy

Do not push until the project owner confirms:

- Whether historic `.env.production` values require key rotation.
- Whether `wrangler.jsonc` placeholders are acceptable for the deploy workflow.
- Whether the large format-only commit should be kept or split into a separate PR.

When approved:

```bash
git push origin main
```

If history cleanup is requested, do not push normally. Follow `docs/security-rotation.md` and get explicit approval before force-pushing.
