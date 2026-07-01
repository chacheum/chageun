#!/usr/bin/env bash
# design-system.md front-matter의 성격(profile) 선언을 점검한다.
# 성격 규칙은 opt-in이라 이 검사는 "조언 전용(비차단)"이다 — 미선언은 막지 않고 '보고'만 한다.
# 미선언 키는 차근 기본값이 적용됨을 알린다. brand-hue만은 무난한 기본값이 없어 더 강하게 경고한다.
set -euo pipefail
DOC="${1:-docs/design-system.md}"
[[ -f "$DOC" ]] || { echo "[check-profile] 문서 없음($DOC) — 성격 점검 생략(비차단)"; exit 0; }
# front-matter(첫 --- ~ 둘째 ---)만 추출
FM=$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f{print}' "$DOC")

# 키별 기본값 (brand-hue는 기본값 없음 → 아래에서 별도 경고)
declare -A DEFAULT=( [dark-mode]=none [animation]=minimal [base-font]=14px [radius]=4px )

for k in dark-mode animation base-font radius; do
  if printf '%s\n' "$FM" | grep -qE "^[[:space:]]+${k}:"; then
    : # 선언됨 — OK
  else
    echo "ℹ️  profile.${k} 미선언 → 차근 기본값 '${DEFAULT[$k]}' 적용"
  fi
done

if printf '%s\n' "$FM" | grep -qE "^[[:space:]]+brand-hue:"; then
  :
else
  echo "⚠️  profile.brand-hue 미선언 — 브랜드 정체라 기본값이 없습니다. 되도록 직접 선언하세요."
fi

echo "[check-profile] 조언 전용 점검 완료(비차단)"
