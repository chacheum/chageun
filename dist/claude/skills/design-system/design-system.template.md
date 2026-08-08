---
version: alpha
name: <PROJECT_NAME>
description: |
  <이 제품이 무엇이고 누가 쓰는지·톤 1~2문장>
ssot: |
  이 파일이 SSOT. <있으면> docs/design.md 등 파생물 명시.
css-path: <예: web/app/globals.css | src/styles/globals.css>
  # 토큰 정합 검사기(check-token-parity.sh)가 읽을 실제 CSS/theme 파일 경로.
  # 프로젝트 구조에 맞게 지정. 이 값이 없으면 토큰 정합 검사는 "설정 필요" 경고를 낸다.
lint-allow-colors: <예: rose, amber, emerald, sky | 없으면 비움>
  # Tailwind 팔레트 이름(rose·amber 등)을 시맨틱 토큰으로 재사용할 때만 선언.
  # check-design-violations.sh가 읽어 그 이름만 직접색상 금지에서 예외 처리한다.
component-registry-path: src/components/design-registry.json
component-roots:
  - src/components
  - components
page-patterns:
  - src/app/**/page.tsx
  - src/app/**/page.jsx
  - src/app/**/layout.tsx
  - src/app/**/layout.jsx
  - app/**/page.tsx
  - app/**/page.jsx
  - app/**/layout.tsx
  - app/**/layout.jsx
  - src/pages/**/*.tsx
  - src/pages/**/*.jsx
  - src/pages/**/*.vue
  - pages/**/*.tsx
  - pages/**/*.jsx
  - pages/**/*.vue
  - src/routes/**/+page.svelte
  - src/routes/**/+layout.svelte
  - src/pages/**/*.astro
profile:
  # 성격 선언: lint/도구가 이 값을 읽는다.
  # 안 적으면 차근 기본값이 적용되고 그 사실을 알린다(아래 "성격 규칙" 참조).
  dark-mode: <none | class | ...>        # 미선언 시 기본값 none
  animation: <minimal | rich | none>     # 미선언 시 기본값 minimal
  base-font: <예: 14px | 13px>           # 미선언 시 기본값 14px
  radius: <예: 4px | 3px | 8px>          # 미선언 시 기본값 4px
  brand-hue: <예: blue | orange>         # 브랜드 정체: 무난한 기본값이 없으니 되도록 직접 선언
colors:
  # 브랜드 스케일 (이름 표준, 값은 각자): check-token-parity.sh가 이름 정합 검사
  brand-50: "<hex>"
  # ... brand-100 ~ brand-900
  # 표면/보더/텍스트/의미(semantic)/카테고리 톤도 이 아래에
typography:
  # 계층 키(예: display-xl, title-lg, body-md, ...): 값은 각자
# ── 부품+변형 슬롯 (v1: 페이지 폭·모달): 값이 아니라 '코드'(CSS 변수·공용 컴포넌트)로 심는다 ──
page-width:
  # 콘텐츠 최대 너비 3계층. CSS 변수 또는 공용 컴포넌트(예: PageContainer)로 코드에 심어
  # 모든 페이지가 참조하게 한다(문서 값만 적으면 재스타일이 안 퍼진다). 값은 각자.
  narrow: "<예: 768px>"
  standard: "<예: 1152px>"
  wide: "<예: 1280px>"
modal:
  # 팝업창. 각 모달은 아래 크기 이름표 중 하나를 고른다(자기 px 정의 금지).
  # 반응형 행동(모바일 바닥시트/데스크톱 떠있는창)은 공용 모달 부품이 담는다.
  sizes: [sm, md, lg, xl, full]
# motion / z-index / opacity / breakpoint / container 는 주석 또는 하위 블록으로
---

## Project Profile
<위 profile: 을 사람이 읽는 표로. 아래 "성격 규칙"에 해당.>

## Overview
<브랜드·톤·타깃 사용자.>

## Colors
<브랜드/표면/보더/텍스트/의미/카테고리 톤. 실제 값은 각자.>

## Typography
<폰트 패밀리 + 계층 + 원칙. 최소 글자 크기 규칙(값은 각자)을 반드시 명시.>

## Layout
<컨테이너·간격·그리드·여백 철학·오버플로 방지.>

## Elevation & Depth
<z-index 레이어. shadow 사용/금지 방침.>

## Shapes
<모서리 둥글기 스케일. radius 값은 각자.>

## Components
<페이지 헤더·모달·버튼·배지·탭 등 + 도메인 컴포넌트 규격.
**컴포넌트는 필요한 만큼만 적는다**: 큰 앱은 수백 개, 랜딩·소규모는 십수 개면 충분.
개수가 많다고 좋은 게 아니라, 쓰는 것만 정확히 정의하는 게 목적.>

## 공용 컴포넌트와 변형

관리 대상은 두 종류다.
- **토큰(값 하나):** 색·간격·둥글기·글자 크기·그림자. 한 곳에 정의하고 참조.
- **공용 컴포넌트와 이름 붙은 변형:** 모달·페이지 레이아웃·페이지 폭처럼 "한 값"이 아니라 "정해둔 몇 종류"인 것. 컴포넌트 하나와 변형 이름표 몇 개를 함께 관리한다.

**원본은 문서가 아니라 코드다.** 문서에 크기를 적기만 하면 값이 코드 여러 곳에 손으로 박혀, 나중에 한 곳만 바꿔도 안 퍼진다. 원본은 **참조 가능한 코드**(CSS 변수·공용 컴포넌트)여야 재사용·재스타일이 진짜가 된다.

**컴포넌트 경계:** 의미 있는 UI는 공용 컴포넌트 파일로 만들고 레지스트리에 등록한다. 페이지와 라우트 파일은 등록된 공용 컴포넌트만 조립한다.

**동작:**
1. UI를 만들기 전 레지스트리를 조회한다.
2. 관련 후보가 없으면 레지스트리 항목을 먼저 추가하고 새 공용 컴포넌트를 만든다.
3. 관련 후보가 있으면 아래 2택 중 하나를 고른다. 기존 변형과 차이가 있으면 새 공용 변형으로 등록한다.

**컴포넌트 선택지(정확히 2개):**
1. 기존 컴포넌트와 변형 사용
2. 기존 컴포넌트에 새 공용 변형 등록

**쉬운 재스타일:** 모든 것이 토큰·공용 컴포넌트를 거치므로, 그 한 곳을 바꾸면 전체가 바뀐다.

**v1 범위:** 페이지 폭과 모달부터. 나머지 레이아웃 가족·헤더·카드는 필요할 때 공용 컴포넌트로 등록한다.

## Accessibility
<**모든 프로젝트 필수(보편 규칙).** WCAG 색대비(일반 ≥4.5:1, 큰 텍스트 ≥3:1), 키보드 도달·포커스 링,
터치 타깃 ≥44×44, 최소 폰트, prefers-reduced-motion, lang 속성.>

## Do's and Don'ts
<금지/권장 목록.>

---

## 규칙 체계 (통일, 값 아님)

규칙은 두 칸으로 나뉜다. **보편 규칙은 모든 프로젝트가 무조건 지킨다(필수).**
**성격 규칙은 취향이라, 안 적으면 차근 기본값이 적용되고 그 사실을 알린다.**

### 보편 규칙 (모든 프로젝트 동일 강제, 필수·예외 없음)
- 색을 코드에 직접 hex/rgb로 박지 말 것 → 토큰/시맨틱 클래스만. (이름 공통, 값 각자)
- WCAG 색대비 최소 기준 충족.
- 임의값 대신 정의된 토큰만.
- UI 제목·레이블은 짧고 자명하게 짓고, 같은 뜻을 반복하는 부제·도움말·설명문을 기본 생성하지 않는다. 보조 문구는 사용자가 명시적으로 요청했거나, 입력 형식·조건·결과·위험·다음 행동·접근성처럼 판단에 필요한 새 정보가 있을 때만 짧게 쓴다.
- "최소 글자 크기 규칙의 존재"를 강제(값은 각자).

### 성격 규칙 (프로젝트가 profile로 선언 → lint가 선언대로 강제)
- dark-mode / animation / base-font / radius / brand-hue.
- 예: animation=rich면 모션 허용, animation=none이면 금지. 같은 lint가 profile을 읽어 분기.
- **미선언 시:** 차근 기본값 적용(dark-mode=none · animation=minimal · base-font=14px · radius=4px)
  + "안 적어서 기본값 적용" 한 줄 알림. **brand-hue는 브랜드 정체라 무난한 기본값이 없으니**
  미선언이면 더 강한 경고(단, 작업을 막지는 않음).

### lint 표준 (자동강제)
- **색 하드코딩 차단(범용·차근 제공):** `scripts/check-design-violations.sh`: Tailwind 팔레트 직접 색·`-[#hex]` 임의값을 막고 토큰만 쓰게 강제(위 `lint-allow-colors` 예외 반영). staged(pre-commit)·`--all`(감사) 모드.
- **프로젝트 고유 측정 규칙은 각자 덧붙인다:** 최소 글자 크기·헤더 높이 고정처럼 프로젝트마다 값이 다른 규칙은 그 프로젝트가 위 검사기에 규칙을 추가하거나 자체 lint로 확장한다(차근이 값을 정하지 않음).
- 도입 방식: **경고(보고) 모드 먼저 → 위반 정리 후 → 커밋 차단 전환.**
- 정합 가드: `scripts/check-token-parity.sh`로 문서↔코드 토큰 이름 정합(위 `css-path`를 읽어 대조).
