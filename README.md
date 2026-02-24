# 주사전자현미경 입자 분석기 (Step1: 스케일 보정)

Next.js(프론트엔드) + FastAPI(백엔드) 모노레포입니다.
현재 구현 범위는 **Step1(스케일 보정)** 입니다.

## 구성

- 프론트엔드: `frontend/` (`Next.js App Router`, `TanStack Query`, `Zustand`, `shadcn/ui`)
- 백엔드: `backend/` (`FastAPI`, `SQLModel(SQLite)`, `Pillow`)
- 스토리지: `backend/storage/`

## Step1 기능

- 이미지 업로드(다중 선택 가능)
- 업로드 완료 즉시 분석 작업공간으로 이동(자동 런 생성)
- 대시보드/작업공간 이미지 목록에서 바로 새 작업 시작
- 작업공간(`/runs/[runId]`)에서 1단계만 수행
  - 하단 커팅(슬라이더 + 숫자 px)
  - µm/px 수동 입력
  - 두 점 측정(점1/점2) + 실제 길이(µm) 입력 후 µm/px 계산
  - 저장 시 항상 새 버전 생성
- 버전 이력 조회 및 이전 버전 불러오기
- 새로고침/재진입 후에도 저장된 Step1 결과 유지

## 저장 구조

- 원본 이미지: `backend/storage/{image_id}/original/{원본파일명}`
- Step1 산출물: `backend/storage/{run_id}/step1/{artifact_id}/`
  - `step1_preview.png` (하단 커팅 적용 미리보기)
  - `calibration.json`

## 업로드 오류 수정 메모

- 원인1: `DELETE /api/images/{image_id}`가 `204` 응답 정의 오류로 FastAPI 앱 시작 단계에서 `AssertionError`를 유발해 백엔드가 뜨지 않았습니다.
- 원인2: 업로드 필드가 `file` 단일 형식에 치우쳐 있고 MIME/확장자 검증이 엄격해 일부 요청이 422로 실패할 수 있었습니다.
- 조치:
  - `DELETE /api/images/{image_id}`를 `response_class=Response` + 명시적 `204` 반환으로 수정하여 서버 기동 오류 제거
  - `POST /api/images`에서 `file` 또는 `files` 모두 수용
  - 업로드 요청 헤더/파일명/용량/예외 스택 로깅 추가
  - 원본 제공 라우트 `GET /api/images/{image_id}/original` 추가
  - 저장 경로를 `storage/{image_id}/original/{파일명}` 구조로 정리

## 로컬 실행

### 1) 백엔드

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2) 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

- 프론트 주소: `http://localhost:3000`
- 백엔드 주소: `http://localhost:8000`
- 필요 시: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`

## Step1 API 예시(curl)

### 1) 이미지 업로드

```bash
curl -X POST "http://localhost:8000/api/images" \
  -F "file=@/절대/경로/sample_sem.png"
```

### 2) 런 생성

```bash
curl -X POST "http://localhost:8000/api/runs" \
  -H "Content-Type: application/json" \
  -d '{"image_id":"<IMAGE_ID>","name":"첫 분석 런"}'
```

### 3) Step1 저장(새 버전 생성)

```bash
curl -X POST "http://localhost:8000/api/runs/<RUN_ID>/steps/1/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "crop_bottom_px": 120,
    "um_per_px": 0.2531,
    "measurement": {
      "ax": 100,
      "ay": 220,
      "bx": 360,
      "by": 220,
      "pixel_distance": 260.0,
      "real_um": 65.8
    }
  }'
```

### 4) 런 산출물(버전 이력) 조회

```bash
curl "http://localhost:8000/api/runs/<RUN_ID>/artifacts"
```

### 5) 아티팩트 파일 조회

```bash
curl -L "http://localhost:8000/api/artifacts/<ARTIFACT_ID>/file?file_index=0" -o step1_preview.png
```
