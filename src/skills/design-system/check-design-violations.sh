#!/usr/bin/env bash
# 차근 디자인 시스템 lint — 색을 코드에 직접 하드코딩하는 행위를 막아 디자인 토큰만 쓰게 강제한다.
# 이 검사기는 프로젝트가 소유해 CI(push/PR)·pre-commit에서 돌린다(차근이 찍어줌). design-system.md가 단일 원본.
#
# 검출:
#   1) Tailwind 기본 팔레트의 숫자 스케일 색 클래스 (bg/text/border/ring/... -{palette}-{num})
#      → 브랜드/시맨틱 토큰만 쓰라는 규칙. 팔레트 이름을 시맨틱 토큰으로 재사용하면(예: rose/amber)
#        design-system.md front-matter의 `lint-allow-colors:`에 선언해 예외 처리한다.
#   2) 임의값 하드코딩 색 (arbitrary value): `-[#rrggbb]`
#
# 모드:
#   (기본) staged — git staged diff의 추가 라인만 (점진 도입, pre-commit용)
#   --all  — 전체 트리 감사
#
# 설정(환경변수, 선택):
#   DESIGN_LINT_DOC    design-system.md 경로 (기본 docs/design-system.md) — 허용목록을 읽음
#   DESIGN_LINT_ROOT   --all 스캔 루트 (기본 .)
#   CHAGEUN_SKIP_DESIGN_LINT=1   검사 우회 (명시적 · 권장 X)
set -euo pipefail

if [[ "${CHAGEUN_SKIP_DESIGN_LINT:-0}" == "1" ]]; then
  echo "[design-lint] CHAGEUN_SKIP_DESIGN_LINT=1 — 검사 우회 (명시 요청)"
  exit 0
fi

MODE="staged"; [[ "${1:-}" == "--all" ]] && MODE="all"
DOC="${DESIGN_LINT_DOC:-docs/design-system.md}"
ROOT="${DESIGN_LINT_ROOT:-.}"

PALETTE="slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
PROPS="bg|text|border|ring|ring-offset|from|via|to|fill|stroke|outline|accent|caret|decoration|divide|shadow"

# 허용 색 이름 — 팔레트명을 토큰으로 재사용하는 경우, design-system.md front-matter에서 읽어 팔레트에서 제외
ALLOW=""
if [[ -f "$DOC" ]]; then
  ALLOW=$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f' "$DOC" \
    | grep -E "^lint-allow-colors:" | head -1 \
    | sed 's/^lint-allow-colors:[[:space:]]*//; s/[[:space:]]*#.*$//' || true)
fi
PAL_EFF="$PALETTE"
if [[ -n "$ALLOW" ]]; then
  # printf '%s\n' 로 끝에 개행을 붙여야 while-read가 마지막(또는 유일) 항목까지 읽는다.
  while IFS= read -r c; do
    [[ -z "$c" ]] && continue
    PAL_EFF=$(printf '%s\n' "$PAL_EFF" | tr '|' '\n' | grep -vx "$c" | paste -sd'|' - || true)
  done < <(printf '%s\n' "$ALLOW" | tr ',' '\n' | sed 's/[[:space:]]//g')
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

if [[ "$MODE" == "staged" ]]; then
  git diff --cached --unified=0 --diff-filter=ACM -- '*.tsx' '*.ts' '*.jsx' '*.js' '*.vue' '*.svelte' '*.astro' \
    | awk '
      /^\+\+\+ b\// { file=substr($0,7); next }
      /^@@ / { match($0,/\+[0-9]+/); line=substr($0,RSTART+1,RLENGTH-1)+0; next }
      /^\+/ && !/^\+\+\+/ { printf "%s\t%d\t%s\n", file, line, substr($0,2); line++ }
    ' > "$TMP/lines.tsv" || true
else
  find "$ROOT" -type d \( -name node_modules -o -name .next -o -name .git -o -name dist -o -name build \) -prune -o \
       -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' -o -name '*.vue' -o -name '*.svelte' -o -name '*.astro' \) -print 2>/dev/null \
    | while IFS= read -r f; do awk -v f="$f" '{printf "%s\t%d\t%s\n", f, NR, $0}' "$f"; done > "$TMP/lines.tsv"
fi

if [[ ! -s "$TMP/lines.tsv" ]]; then echo "[design-lint] 검사할 라인 없음."; exit 0; fi

VIOL=0

# 룰 1: 직접 팔레트 색 클래스 (design-lint-ignore 주석이 있는 라인은 건너뜀)
HITS=$(awk -F'\t' -v re="(${PROPS})-(${PAL_EFF})-[0-9]" '
  $3 ~ /design-lint-ignore/ { next }
  $3 ~ re { printf "   %s:%d: %s\n", $1, $2, $3 }' "$TMP/lines.tsv" || true)
if [[ -n "$HITS" ]]; then
  echo ""
  echo "❌ [직접 색상 금지] Tailwind 팔레트 색 대신 디자인 토큰(브랜드/시맨틱)을 쓰세요."
  echo "   팔레트명을 토큰으로 쓰는 프로젝트면 design-system.md front-matter의 lint-allow-colors에 선언."
  echo "$HITS"
  VIOL=$((VIOL+1))
fi

# 룰 2: 임의값 하드코딩 색 (-[#hex] / -[rgb(...)] / -[hsl(...)])
#   {n,m} 구간표현식은 구형 awk(mawk)에서 미동작 → 고정 문자클래스(3자+)로 이식성 확보.
HEX=$(awk -F'\t' '
  $3 ~ /design-lint-ignore/ { next }
  $3 ~ /-\[#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]+\]/ || $3 ~ /-\[(rgb|rgba|hsl|hsla)\(/ {
    printf "   %s:%d: %s\n", $1, $2, $3 }' "$TMP/lines.tsv" || true)
if [[ -n "$HEX" ]]; then
  echo ""
  echo "❌ [하드코딩 색상 금지] -[#hex] 임의값 대신 정의된 토큰을 쓰세요."
  echo "$HEX"
  VIOL=$((VIOL+1))
fi

LINES=$(wc -l < "$TMP/lines.tsv")
if [[ "$VIOL" -gt 0 ]]; then
  echo ""
  if [[ "$MODE" == "staged" ]]; then
    echo "⛔ 디자인 시스템 위반 ${VIOL}종 — 신규 추가/수정 라인에서 발견. 커밋 차단."
    echo "   비상 우회(권장 X): CHAGEUN_SKIP_DESIGN_LINT=1 git commit ..."
  else
    echo "⛔ 디자인 시스템 위반 ${VIOL}종 (전체 트리 ${LINES}라인 감사)"
  fi
  exit 1
fi
echo "[design-lint] 통과 (${MODE} ${LINES}라인 검사)"
exit 0
