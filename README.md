# 이야기방 (Story Chat)

클로드 API로 동작하는 개인용 롤플레이 스토리 챗 앱.

## 로컬에서 실행

```bash
npm install
npm run dev
```

## 배포 (GitHub Pages, 자동)

1. 이 폴더 전체를 새 GitHub 저장소에 push 하세요.
2. 저장소 **Settings → Pages** 에서 **Source**를 `GitHub Actions`로 선택하세요.
3. `main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 자동으로 빌드 후 배포해요.
4. 몇 분 후 `https://<사용자명>.github.io/<저장소이름>/` 에서 접속 가능해요.

## API 키

- 앱을 처음 열면 API 키 입력창이 떠요. [console.anthropic.com](https://console.anthropic.com)에서 발급받은 키를 넣으면 돼요.
- 키는 **이 브라우저의 localStorage에만 저장**되고, 코드나 GitHub 저장소에는 절대 포함되지 않아요. 저장소를 public으로 열어도 안전해요.
- 단, 같은 브라우저를 쓰는 다른 사람이 개발자도구를 열면 로컬에 저장된 키를 볼 수 있어요 — 본인만 쓰는 기기에서 사용하세요.
- 키가 없는 상태로 메시지를 보내면 설정창이 다시 떠요.

## 모델 변경

`src/App.jsx` 상단의 `MODEL` 상수를 바꾸면 다른 모델을 쓸 수 있어요. 최신 모델 이름은 [Anthropic 문서](https://docs.claude.com)에서 확인하세요.

## 데이터

- 캐릭터, 대화 기록, API 키 모두 브라우저의 localStorage에 저장돼요 (기기별로 분리, 서버 전송 없음).
- 브라우저 저장공간을 지우면 데이터도 함께 사라져요.
