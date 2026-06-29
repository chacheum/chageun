# 차근 (chageun)

**비개발자가 안전하게 만들도록 돕는 워크플로우** — 작업카드·검증 게이트·실제 구동 검증·쉬운 말 요약. Claude Code와 Codex CLI 양쪽 지원.

---

## 무엇을 해주나

기획이 약하면 원하던 것과 다른 게 나오고, 검증이 약하면 무한 디버깅 지옥에 갇힙니다. 차근은 **기획 → 게이트 → 구현 → 실제 구동 검증 → 마무리** 흐름으로 그 두 함정을 막아줍니다.

코드는 Claude가, 설명은 쉬운 말로, 판단은 당신이.

---

## 설치

### Claude Code

```
/plugin marketplace add chacheum/chageun
/plugin install chageun
```

새 세션이 시작되면 워크플로우가 자동으로 켜집니다.

### Codex CLI

```
codex plugin marketplace add chacheum/chageun
```

그다음 `/plugins`에서 `chageun`를 설치하고 `/reload-plugins`를 실행합니다.

게이트 에이전트를 분리된 컨텍스트로 돌리고 싶으면 `~/.codex/config.toml`에 아래를 추가하세요. 없어도 인라인으로 동작합니다.

```toml
[features]
multi_agent = true
```

---

## 개발 / 기여

정본(소스)은 `src/`에 있습니다.

```bash
npm run build   # src/ → dist/claude + dist/codex 생성 (결과물은 커밋 대상)
npm test        # 골든·패리티·드리프트 가드 (--test-concurrency=1)
```

`dist/`는 빌드 산출물이지만 **레포에 커밋**합니다 — 마켓플레이스가 소스를 직접 참조하기 때문입니다.

설계·계획 문서는 로컬 `docs/`에 두며 `.gitignore`로 제외됩니다.

---

## 라이선스

MIT
