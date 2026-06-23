# k-fact260615

한국어 팩트체크 보조 웹앱입니다. 텍스트, URL, YouTube 자막, 음성 입력에서 검증 가능한 주장을 추출하고 AI 판정, 근거, 반대 근거, 신뢰도, 감사 로그를 구조화해 보여줍니다.

## 주요 기능

- 텍스트/URL/YouTube/음성 입력 기반 팩트체크
- 입력 중 빠른 분석과 정식 분석 분리
- 1차 AI 판정과 2차 검색 기반 심층 분석 흐름
- 한국 근현대사, 영토, 과학 오정보, 시대착오 주장 보정 규칙
- 다음 팩트체크, SNU 팩트체크, 네이버 뉴스, YouTube RSS 등 실시간 이슈 수집
- 분석 히스토리, 공유 링크, 관리자 대시보드, API 키 관리
- Supabase 저장소와 Cloudflare Workers/KV/Workers AI 배포 구조

## 기술 스택

- Runtime/package manager: Bun
- Frontend/server framework: TanStack Start, TanStack Router, Vite, React 19
- Data fetching: TanStack Query
- Styling: Tailwind CSS 4
- AI: Vercel AI SDK, OpenAI, Anthropic, Gemini, Cloudflare Workers AI fallback
- Database/auth: Supabase
- Deployment: Cloudflare Workers, Wrangler, Workers KV
- Test: Vitest
- Lint/format: ESLint, Prettier

## 로컬 실행

```bash
bun install
cp .env.example .env.local
bun run dev
```

개발 서버는 Vite/TanStack Start 기본 설정을 따릅니다. 로컬에서 Supabase 또는 외부 API 키가 없으면 일부 기능은 빈 결과나 graceful fallback으로 동작합니다.

## 주요 명령

```bash
bun run dev        # 개발 서버
bun run build      # 프로덕션 빌드
bun run preview    # 빌드 결과 미리보기
bun run lint       # ESLint + Prettier 검사
bun run format     # Prettier 포맷
bun run test       # Vitest 테스트
```

## 환경 변수

환경 파일은 로컬 전용입니다. 실제 값이 들어간 `.env`, `.env.local`, `.env.production`은 커밋하지 마세요. 저장소에는 `.env.example`만 유지합니다.

### 클라이언트 공개 변수

브라우저 번들에 포함되어도 되는 값만 `VITE_` 접두사를 사용합니다.

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
VITE_ADMIN_EMAIL=
```

### 서버/Worker 비밀 변수

아래 값은 브라우저에 노출되면 안 됩니다. 로컬에서는 `.env.local`, 배포 환경에서는 Cloudflare Workers secrets/vars 또는 Supabase 설정으로 주입하세요.

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAIL=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
TAVILY_API_KEY=
GOOGLE_FACTCHECK_API_KEY=
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
YOUTUBE_API_KEY=
ECOS_API_KEY=
KOSIS_API_KEY=
ENCRYPTION_KEY=
RESULT_SIGNING_KEY=
CF_GATEWAY_ID=
```

## Supabase

마이그레이션은 `supabase/migrations`에 있습니다. 주요 테이블은 다음과 같습니다.

- `analyses`: 분석 입력, 판정, 주장별 결과, 상태, 감사/무결성 데이터
- `api_keys`: 관리자 등록 AI API 키
- `admin_audit_log`: 관리자 작업 감사 로그

운영 DB에서는 마이그레이션이 순서대로 적용됐는지 반드시 확인하세요. 특히 초기 마이그레이션의 공개 조회 정책은 이후 마이그레이션에서 철회되므로, 운영 RLS 정책이 최종 상태인지 점검해야 합니다.

## Cloudflare Workers 배포

`wrangler.jsonc`가 Workers 배포 설정입니다.

- `main`: `dist/server/server.js`
- `assets.directory`: `dist/client`
- `AI` binding: Workers AI fallback
- `NEWS_CACHE` KV: 트렌딩 뉴스와 분석 캐시 폴백

저장소의 `wrangler.jsonc`에는 실제 프로젝트 값 대신 플레이스홀더가 들어갑니다. 배포 전 Cloudflare dashboard, Wrangler secrets, 또는 배포 자동화에서 실제 값을 주입해야 합니다.

배포 전 확인 사항:

1. `bun run build`가 통과해야 합니다.
2. 서버 비밀 변수는 Wrangler secrets 또는 Cloudflare dashboard에서 설정해야 합니다.
3. 공개 저장소에 운영 비밀 값이나 개인 운영 설정을 커밋하지 않았는지 확인해야 합니다.

## 보안 및 릴리스 문서

- [보안 키 회전 및 히스토리 정리](docs/security-rotation.md)
- [릴리스 및 원격 반영 체크리스트](docs/release-checklist.md)

## 품질 기준

변경 전후로 다음 명령을 실행하세요.

```bash
bun run test
bun run build
bun run lint
```

현재 테스트는 파이프라인 유틸 중심이므로, 분석 생성/조회/공유/관리자/뉴스 수집/권한 흐름 테스트를 계속 보강해야 합니다.

## 운영 전 체크리스트

- `.env.production`이 Git에 추적되지 않는지 확인: `git ls-files .env.production`
- Supabase RLS 최종 정책 확인
- Cloudflare Workers secrets/vars 설정 확인
- 관리자 이메일과 API 키 관리 경로 접근 제한 확인
- `bun run lint`, `bun run test`, `bun run build` 통과 확인
- 외부 API 키가 없을 때 graceful fallback이 사용자에게 자연스럽게 표시되는지 확인
