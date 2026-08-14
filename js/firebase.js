/* ══════════════════════════════════════════════════════════════
   firebase.js — Firebase Auth 클라이언트 초기화
   빌드 도구가 없는 프로젝트라 CDN의 ES 모듈 URL을 그대로 import한다
   (번들러 없이 <script type="module">에서 바로 동작).
═══════════════════════════════════════════════════════════════ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* Firebase 콘솔 → 프로젝트 설정 → 일반 → "내 앱"에서 그대로 복사한 값.
   apiKey는 비밀키가 아니라 공개 클라이언트 식별자라 커밋해도 안전하다 —
   실제 접근 제어는 백엔드의 verifyIdToken + 이메일 도메인 검사가 담당한다. */
const firebaseConfig = {
  apiKey: 'AIzaSyADVHyBCKMLNdFUWSWiNqR8H_Cms5P5KLE',
  authDomain: 'bloomcrm-2d3a2.firebaseapp.com',
  projectId: 'bloomcrm-2d3a2',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export { signInWithEmailAndPassword, onAuthStateChanged, signOut };
