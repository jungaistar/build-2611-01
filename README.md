# build-2611-01 · 개발 계획 시뮬레이터

생성형 AI 업무자동화 전문가과정 **2차수** 수강생 프로젝트 01 — 기획 정호영.

**바로 쓰기: https://aebonlee.github.io/build-2611-01/**

로드맵 Raw Data(엑셀 시트 3장)를 올리면 개발~생산 기간의 부문별 주간 업무 부하를 계산하고,
부족한 주의 사유(어느 기종·단계 때문인지)와 가정 변경(일정 이동·인원 변경) 전후 비교를 보여 줍니다.
파일은 브라우저 안에서만 처리하며 서버로 올라가지 않습니다.

| 파일 | 역할 |
|---|---|
| `js/sim.js` | 계산 엔진(부하·판정·사유·가정·비교) — 판정은 전부 여기 |
| `js/app.js` | 화면 |
| `test/logic.test.js` | 계산 규칙 테스트 `node test/logic.test.js` |
| `test/smoke.browser.js` | 화면 연기 테스트(playwright) |
| `CLAUDE.md` | 작업 지시서 + 기획서 원문 |

예제 데이터는 실제 사내 데이터가 아닙니다.

## 기획서 · 버전

- 사이트 「기획서」 페이지: https://aebonlee.github.io/build-2611-01/plan.html — 워드 판 내려받기
- 워드 판: `docs/기획서/build-2611-01_정호영_개발계획시뮬레이터_기획서_v<버전>.docx` (버전마다 남김)
- 원본: `docs/plan.json` → 생성기 `build-2611-00/tools/plandoc/make_plan.py` 로 워드·그림·plan.html·CHANGELOG.md 를 다시 만든다
- 버전을 올릴 때: `plan.json` 의 `version` 을 바꾸고 `versions` 맨 앞에 바뀐 점을 적은 뒤 생성기를 다시 돌린다
