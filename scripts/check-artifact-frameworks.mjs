#!/usr/bin/env node
// =============================================================================
// 산출물(IPA)이 «기기에 없는 프레임워크»를 링크하지 않는지 검사
//
// 📥 **출처: 형제 프로젝트 헤어핀(syncbarber)** — 2026-09-20 에 받아 왔다.
//    그쪽이 build 184·185 를 연달아 버리고 얻은 검사다. 로직은 프로젝트 독립적이라
//    그대로 쓴다(우리 쪽 수정 없음).
//
// 🔴 **투투리스트는 Expo SDK 54 라 아직 이 사고의 사정권이 아니다** — 프리컴파일
//    xcframework 배포는 **Expo 56/57 부터**이고 54 는 전부 소스 빌드다.
//    ⇒ 지금은 «통과하는 게 정상»이고, **SDK 57 로 올리는 순간부터 진짜 방어선**이 된다.
//    그래서 미리 붙여 둔다 — 올리고 나서 만들면 이미 늦다.
//
// ▶ 왜 필요한가 (2026-09-16, 실제로 두 번 올리고 두 번 다 즉사했다)
//   1.10.33 build 184·185 가 사용자 아이폰에서 **켜자마자** 죽었다. 크래시 로그:
//
//       "termination": { "namespace":"DYLD", "indicator":"Library missing",
//         "details":["(terminated at launch; ignore backtrace)"],
//         "reasons":["Library not loaded: @rpath/Testing.framework/Testing",
//                    "Referenced from: …/HAIRPIN.app/Frameworks/ExpoContacts.framework"] }
//
//   `expo-contacts@57.0.5` 가 배포한 **미리 컴파일된 xcframework** 에 Swift Testing
//   프레임워크가 강하게 링크돼 있었다(expo/expo #50101·#50102). 기기에는 그 프레임워크가
//   없으므로 dyld 가 **main() 을 부르기도 전에** 앱을 죽인다.
//
// ▶ 이 실패가 **왜 아무 검사에도 안 걸렸나** — 이게 핵심이다
//   · 빌드 성공(컴파일·링크 다 통과) · 업로드 성공 · TestFlight «VALID» 판정까지 통과
//   · 크래시 스택은 `dyld4::halt` 까지만 남고 **로그가 스스로 «backtrace 는 무시하라»** 고 한다
//   · **시뮬레이터에는 Testing.framework 가 있어서 재현되지 않는다**
//     (「시뮬에서 뜨면 됐다」가 여기서 또 깨졌다)
//   · 우리 `npm run check` 는 JS·타입만 본다 — 네이티브 링크는 사각지대였다
//   ⇒ 사람이 기기에서 눌러 보기 전까지 **아무도 모른다.** 그래서 산출물을 직접 연다.
//
// ▶ 무엇을 보나
//   IPA 안의 **모든 프레임워크와 앱 본체**에서 `otool -L` 을 돌려,
//   「기기에 없는 것이 확실한」 프레임워크를 **강하게(non-weak)** 링크하면 실패시킨다.
//   weak 링크는 없어도 앱이 뜨므로 통과시킨다 — 여기서 갈린다.
//
//   실행: node scripts/check-artifact-frameworks.mjs <ipa 경로>
//   종료코드: 문제 없으면 0, 있으면 1
// =============================================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 기기에 존재하지 않는 프레임워크들 — 이걸 강하게 링크하면 실행 즉시 죽는다.
 * 🔑 전부 **테스트 전용**이다. 릴리스 번들에 들어갈 이유가 없다.
 */
const FORBIDDEN = [
  { name: "Testing", why: "Swift Testing — 테스트 전용. expo-contacts@57.0.5 가 실제로 이걸 섞어 보냈다(expo/expo #50101)" },
  { name: "XCTest", why: "XCTest — 테스트 전용. 릴리스 앱에 들어가면 dyld 가 앱을 못 띄운다" },
  { name: "XCUIAutomation", why: "UI 테스트 전용" },
];

const ipaPath = process.argv[2];
if (!ipaPath || !fs.existsSync(ipaPath)) {
  console.error("사용법: node scripts/check-artifact-frameworks.mjs <ipa 경로>");
  process.exit(2);
}

// IPA 를 임시 폴더에 푼다(본체 + 프레임워크만).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwcheck-"));
try {
  execFileSync("unzip", ["-qo", ipaPath, "Payload/*", "-d", tmp], { stdio: "pipe" });
} catch {
  console.error("❌ IPA 를 풀지 못했습니다:", ipaPath);
  process.exit(2);
}

const payload = path.join(tmp, "Payload");
const appDir = fs.readdirSync(payload).find((d) => d.endsWith(".app"));
if (!appDir) {
  console.error("❌ IPA 안에 .app 이 없습니다");
  process.exit(2);
}
const appPath = path.join(payload, appDir);
const appName = appDir.replace(/\.app$/, "");

/** 검사 대상: 앱 본체 + 모든 프레임워크 바이너리(dSYM 은 제외 — 실행에 안 쓰인다). */
const targets = [{ label: `${appName} (앱 본체)`, bin: path.join(appPath, appName) }];
const fwDir = path.join(appPath, "Frameworks");
if (fs.existsSync(fwDir)) {
  for (const entry of fs.readdirSync(fwDir)) {
    if (!entry.endsWith(".framework")) continue;
    const n = entry.replace(/\.framework$/, "");
    const bin = path.join(fwDir, entry, n);
    if (fs.existsSync(bin)) targets.push({ label: n, bin });
  }
}

const problems = [];
let checked = 0;

for (const { label, bin } of targets) {
  let out;
  try {
    out = execFileSync("otool", ["-L", bin], { encoding: "utf8" });
  } catch {
    continue; // 바이너리가 아니면 건너뛴다
  }
  checked += 1;
  for (const line of out.split("\n")) {
    for (const f of FORBIDDEN) {
      // `@rpath/Testing.framework/Testing (compatibility …, weak)` 꼴을 본다
      if (!line.includes(`/${f.name}.framework/`)) continue;
      // 🔑 weak 는 없어도 앱이 뜬다 — 여기서 갈린다. 단정하지 말고 표시만 다르게.
      const weak = /\bweak\b/.test(line);
      if (weak) continue;
      problems.push({ label, framework: f.name, why: f.why, line: line.trim() });
    }
  }
}

console.log(`\n산출물 프레임워크 검사 — 바이너리 ${checked}개\n`);

// 🔴 우리 쪽 추가(2026-09-20): 검사 대상이 0 이면 «통과»가 아니라 «검사를 못 한 것»이다.
//    IPA 구조가 예상과 다르면 아무것도 안 훑고 ✅ 를 찍는다 — verify-bundle-env 의
//    대조군 원칙과 같은 함정이라 여기서 멈춘다.
//    (정상 IPA 에는 앱 본체 실행 바이너리가 최소 1개는 반드시 있다.)
if (checked === 0) {
  console.error('🔴 검사한 바이너리가 0 개입니다 — 통과가 아니라 **검사를 못 한 것**입니다.');
  console.error('   Payload/<앱>.app 안에서 실행 바이너리를 찾지 못했습니다. 산출물 구조를 확인하세요.');
  process.exit(2);
}

if (problems.length === 0) {
  console.log(`✅ 기기에 없는 프레임워크를 강하게 링크하는 곳은 없습니다.\n`);
  process.exit(0);
}

console.log(`❌ 위험 ${problems.length}건 — 이대로 올리면 **앱이 켜자마자 죽습니다**\n`);
for (const p of problems) {
  console.log(`  🔴 ${p.label} → ${p.framework}.framework`);
  console.log(`     ${p.line}`);
  console.log(`     ${p.why}\n`);
}
console.log(`해결: 그 패키지의 버전을 바꾸거나(2026-09-16 에는 expo-contacts 57.0.5 → 57.0.4),`);
console.log(`      EXPO_USE_PRECOMPILED_MODULES 를 꺼서 소스에서 빌드한다.\n`);
process.exit(1);
