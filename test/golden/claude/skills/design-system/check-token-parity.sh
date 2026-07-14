#!/usr/bin/env bash
# 문서 front-matter의 brand-* 토큰 이름과 CSS의 --color-brand-* 이름 정합을 검증한다.
# CSS 경로는 문서 front-matter의 `css-path:` 키에서 읽는다(프로젝트마다 다름).
# 경로가 없거나 파일이 없으면 조용히 통과하지 않고 "설정 필요"로 눈에 띄게 실패한다(거짓 안심 방지).
set -euo pipefail
DOC="${1:-docs/design-system.md}"

FM=$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f{print}' "$DOC")

# css-path 값 추출 (2번째 인자로 override 가능; 없으면 front-matter에서)
CSS="${2:-}"
if [[ -z "$CSS" ]]; then
  CSS=$(printf '%s\n' "$FM" | grep -E "^css-path:" | head -1 | sed 's/^css-path:[[:space:]]*//; s/[[:space:]]*#.*$//; s/^["'\'']//; s/["'\'']$//' || true)
fi

if [[ -z "$CSS" ]]; then
  echo "⚠️  css-path 미설정 — 문서 front-matter에 'css-path: <CSS 파일 경로>'를 추가하세요."
  echo "⛔ 토큰 정합 검사를 건너뜁니다(설정 필요). 통과 아님."
  exit 2
fi
if [[ ! -f "$CSS" ]]; then
  echo "⚠️  css-path 파일 없음: $CSS — 경로를 확인하세요."
  echo "⛔ 토큰 정합 검사를 건너뜁니다(설정 필요). 통과 아님."
  exit 2
fi

SCALE=(50 100 200 300 400 500 600 700 800 900)
FAIL=0
for n in "${SCALE[@]}"; do
  in_doc=$(grep -cE "^[[:space:]]+brand-${n}:" "$DOC" || true)
  in_css=$(grep -cE "^[[:space:]]*--color-brand-${n}:" "$CSS" || true)
  if [[ "$in_doc" -eq 0 ]]; then echo "❌ 문서에 brand-${n} 없음"; FAIL=1; fi
  if [[ "$in_css" -eq 0 ]]; then echo "❌ CSS($CSS)에 --color-brand-${n} 없음"; FAIL=1; fi
done
if [[ "$FAIL" == "1" ]]; then echo "⛔ 토큰 이름 정합 실패"; exit 1; fi
echo "[check-token-parity] 통과 — brand 스케일 10종 문서↔코드($CSS) 이름 정합 (이름만 대조 — 값 드리프트는 못 잡음)"
