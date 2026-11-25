# MINDLET

Next.js + Supabase + Vercel 기반의 단일 메모 보드입니다. 주소를 아는 사람은 누구나 메모를 조회·작성할 수 있고, 작성자는 4자리 암호로, 관리자는 별도 로그인 후 메모를 삭제합니다.

## 실행 순서

1. 압축을 푼 프로젝트 폴더를 엽니다.
2. 버전 확인: `node -v`, `npm -v` (Node.js 22 이상 권장. 개발 시 v22.17.0 / npm 10.9.2 사용)
3. `npm ci`
4. `.env.example`을 `.env.local`로 복사하고 자신의 Supabase 값을 입력합니다.
5. 관리자 암호 해시 생성 (PowerShell/bash 공통):

   ```bash
   node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "원하는-관리자-암호"
   ```

   - `.env.local`에는 해시 안의 모든 `$`를 `\$`로 바꿔 넣습니다. (Next.js가 `$NAME`을 변수로 확장하기 때문입니다.)
   - Vercel 대시보드에는 해시를 그대로(백슬래시 없이) 붙여넣습니다.
6. 세션 비밀값 생성 (32자 이상):

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

7. DB 준비 (Supabase SQL Editor)
   - 신규 빈 DB: `schema.sql` 실행
   - 기존 `memos` 테이블이 있는 DB: 백업 후 `migration.sql` 상단의 전제조건과 STEP 0 확인 쿼리를 읽고 STEP 1 실행 (기존 ID·제목·내용·일시·bcrypt 해시 보존)
8. `npm run dev` → http://localhost:3000

환경 변수 누락·형식 오류는 서버 로그에 변수 이름만 표시됩니다 (값은 출력하지 않음).

## Vercel 배포

GitHub 저장소를 Vercel에 연결하고 Project Settings → Environment Variables에 다섯 개를 등록한 뒤 배포합니다.

| 이름 | 비고 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 공개 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 공개 (Publishable key) |
| `SUPABASE_SECRET_KEY` | 서버 전용 (Secret key) |
| `ADMIN_PASSWORD_HASH` | 서버 전용, bcrypt 해시 |
| `ADMIN_SESSION_SECRET` | 서버 전용, 32자 이상 |

배포 후 확인: 메모 작성/삭제, 관리자 로그인/삭제/전체 삭제/로그아웃. 레거시 `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 사용하지 않습니다.

## 보안 구조

- 브라우저는 Publishable key로 `memos`의 공개 컬럼만 조회합니다 (RLS + 컬럼 GRANT).
- 작성·삭제·관리자 기능은 Node.js 런타임 API에서 Secret key(`server-only`)로 수행합니다.
- 작성자 암호는 서버에서 bcrypt 해시 후 `memo_credentials`에 저장하며 메모와 함께 RPC 한 번(원자적)으로 기록됩니다.
- 요청 제한은 Supabase `rate_limits` 테이블과 `rate_limit_hit` RPC로 구현합니다 (작성 IP당 10분 20회, 삭제 IP당 10분 30회, 메모+IP별 삭제 실패 10분 5회, 관리자 로그인 IP당 15분 5회). bcrypt 실행 전에 확인하며 저장소 오류 시 작업을 진행하지 않습니다.
- 클라이언트 IP: Vercel은 `x-forwarded-for`/`x-vercel-forwarded-for`를 플랫폼이 설정하고 외부 값을 덮어쓰므로(https://vercel.com/docs/headers/request-headers) Vercel 환경에서만 이 헤더를 신뢰하고, 그 외 환경은 헤더를 무시합니다.
- 관리자 세션: 랜덤 토큰 → `HMAC(ADMIN_SESSION_SECRET)` 검증값과 만료시각만 `admin_sessions`에 저장, 8시간, `HttpOnly; SameSite=Strict; Path=/` (+ 프로덕션 `Secure`).
- 모든 상태 변경 API는 `Origin` 헤더와 요청 URL의 origin을 비교하며 없거나 다르면 403.
