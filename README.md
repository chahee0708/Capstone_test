# SafeBite

질환(2형·1형 당뇨, 고혈압, 이상지질혈증, 신장병)과 알레르기 정보를 바탕으로 식품이 나에게 적합한지 판정하는 서비스입니다.

| 구성 | 설명 | 포트 |
|---|---|---|
| `frontend` | React 18 + Vite + Tailwind | 5173 |
| `backend` | Express (인증/프로필/판정), JWT 쿠키 인증 | 4000 |
| `ml` | FastAPI — 2형 당뇨용 GI 등급 예측 | 8000 |
| MySQL | 사용자·프로필 (`backend/init.sql`) | 3307(호스트) |
| Neo4j | 식품 영양성분·원재료 (`data/` 스크립트로 적재) | 7474/7687 |

## 실행

```bash
docker compose up --build
```

식품 데이터는 별도로 적재합니다: `python -I data/load_backend_schema.py --neo4j` (접속 정보는 스크립트 상단 참고).

### 환경변수 (backend)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `JWT_SECRET` | (개발: 임의 생성) | **운영에서는 필수.** 누락 시 `NODE_ENV=production` 이면 서버가 시작되지 않습니다 |
| `CORS_ORIGIN` | `http://localhost:5173` | 프론트엔드 오리진 |
| `ML_SERVICE_URL` | `http://ml:8000` | ML 서비스 주소 |
| `COOKIE_SECURE` | `NODE_ENV=production` 일 때 true | HTTPS 환경에서 쿠키 `Secure` |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | — | MySQL 접속 정보 |
| `NEO4J_URI` `NEO4J_USER` `NEO4J_PASSWORD` | — | Neo4j 접속 정보 |

### 테스트 계정 (`backend/init.sql`, 새 DB 볼륨 기준)

`user1@test.com` ~ `user6@test.com` / `password123` — 2형 당뇨, 고혈압(Stage II), 이상지질혈증, 신장병, 1형 당뇨, 건강인 순서.

## 테스트

```bash
cd backend && npm test        # node:test (의존성 추가 없음)
cd frontend && npx vite build # 프로덕션 빌드
cd ml && python -m unittest discover -s tests   # OCR 파서/후처리 (모델 불필요)
```

### OCR 정확도 평가

라벨 사진 폴더(`<대분류>/<중분류>/<제품명>.png`)를 실제 파이프라인으로 읽고 정답 CSV(`manual_foods.csv` 형식)와 비교합니다.

```bash
cd ml
python tools/run_ocr_cache.py --input <사진 폴더> --out <캐시 폴더>        # OCR 실행 (장당 약 5~15초)
python tools/eval_vs_csv.py --csv <manual_foods.csv> --cache <캐시 폴더>   # 정답과 비교
python tools/eval_vs_csv.py --csv <manual_foods.csv> --cache <캐시 폴더> --reparse   # 파서만 바꿔 재평가 (OCR 재실행 없음)
```

OCR 동작 환경변수(`ml`): `OCR_USE_CLS`(기본 0), `OCR_INVERT_PASS`(`auto`|`always`|`off`), `OCR_REFINE_TABLE`(기본 0), `OCR_DET_MODEL`(`small`|`medium`).

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/auth/register` | `{name,email,password,profile?}` 가입 + 프로필 저장, 쿠키 발급 |
| POST | `/auth/login` · `/auth/logout` · `/auth/refresh` | 로그인/로그아웃/토큰 갱신 |
| GET | `/auth/me` | 현재 사용자 |
| GET·PUT | `/users/me` (또는 본인 `/users/:id`) | 프로필 조회/부분 수정 — 타인 id 는 403 |
| GET | `/recommend/search?q=` | 식품명 자동완성 |
| POST | `/recommend` | `{foodName}` 판정 — 사용자는 세션으로 식별 |

작업 이력과 남은 과제는 [IMPROVEMENT_LOG.md](IMPROVEMENT_LOG.md) 를 참고하세요.
