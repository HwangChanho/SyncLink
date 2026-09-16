/**
 * withIosDeploymentTarget — 의존 Pod 들의 iOS 배포 타겟 **하한을 강제**한다.
 *
 * 왜 필요한가 (2026-09-16, Xcode 27.0 로 올라가면서 터졌다):
 *   Xcode 27 부터 `IPHONEOS_DEPLOYMENT_TARGET` 15.0 미만은 **경고가 아니라 에러**다.
 *     error: The iOS deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 9.0,
 *            but the range of supported deployment target versions is 15.0 to 27.0.x
 *   우리 앱 타겟은 15.1/16.0 이라 멀쩡한데, **의존 Pod 들이 자기 podspec 에 낮은 값을 선언**해 둔다
 *   (AppAuth 9.0 · SDWebImage 9.0 · GTMAppAuth 10.0 · RevenueCat 13.0 · 그 외 12.0/12.4 다수).
 *   CocoaPods 는 podspec 값이 Podfile 의 `platform` 보다 낮아도 그대로 두기 때문에
 *   **아카이브가 통째로 깨진다.** 1.4.17 빌드가 실제로 여기서 멈췄다.
 *
 * 🔴 왜 Podfile 을 직접 고치지 않고 플러그인으로 두는가:
 *   `ios/` 는 .gitignore 대상이라 **직접 수정은 커밋되지 않고**, `expo prebuild` 가 Podfile 을
 *   새로 만들면 조용히 사라진다. 그러면 다음 빌드에서 같은 에러가 그대로 재발한다.
 *   실제로 이 프로젝트는 "로컬 수정이 prebuild 로 날아가는" 사고를 여러 번 겪었다.
 *
 * ⚠️ `expo-build-properties` 의 `ios.deploymentTarget` 으로는 해결되지 않는다.
 *   그 옵션은 Podfile 의 `platform :ios, ...`(= 우리 앱의 하한)만 바꿀 뿐,
 *   **개별 Pod 타겟의 빌드 설정은 건드리지 않는다.** 문제는 후자다.
 *
 * 동작: prebuild 단계에서 Podfile 의 `post_install` 블록 끝에 하한 강제 루프를 주입한다.
 *   - 멱등하다(`IPHONEOS_DEPLOYMENT_TARGET` 문자열이 이미 있으면 아무것도 하지 않는다).
 *   - 주입은 `react_native_post_install(...)` **뒤**에 놓는다 — 그쪽이 먼저 손댄 값까지 덮어쓰기 위해서다.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** 앱의 하한(Podfile `platform :ios`)과 같은 값. 여기만 고치면 된다. */
const MIN_TARGET = '15.1';

/** 이미 주입됐는지 판정하는 표식. Podfile 에 이 문자열이 있으면 건너뛴다. */
const MARKER = 'IPHONEOS_DEPLOYMENT_TARGET';

/** post_install 블록 끝에 삽입할 Ruby 코드. */
const SNIPPET = `
    # [withIosDeploymentTarget] Xcode 27 은 배포 타겟 15.0 미만을 에러로 거부한다.
    # 의존 Pod 들이 podspec 에 9.0~13.0 을 선언해 두므로 앱 하한까지 끌어올린다.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['${MARKER}']
        if current.nil? || current.to_f < ${MIN_TARGET}
          config.build_settings['${MARKER}'] = '${MIN_TARGET}'
        end
      end
    end
`;

/**
 * Podfile 문자열에 스니펫을 주입한다.
 *
 * @param {string} contents 원본 Podfile 내용
 * @returns {string} 주입된 내용. 이미 적용돼 있거나 앵커를 못 찾으면 원본 그대로.
 */
function injectPostInstall(contents) {
  // 멱등: 이미 하한 강제가 들어 있으면 손대지 않는다.
  if (contents.includes(MARKER)) return contents;

  const startIdx = contents.indexOf('post_install do |installer|');
  if (startIdx < 0) {
    // post_install 자체가 없는 Podfile 은 이 프로젝트 구성이 아니다 — 조용히 넘긴다.
    return contents;
  }

  // post_install 블록의 끝(들여쓰기 2칸짜리 `end`)을 찾아 그 **앞**에 넣는다.
  // 블록 안쪽의 `end`(4칸 이상 들여쓰기)와 구별하기 위해 정확히 '\n  end' 를 찾는다.
  const endIdx = contents.indexOf('\n  end', startIdx);
  if (endIdx < 0) return contents;

  return contents.slice(0, endIdx) + '\n' + SNIPPET + contents.slice(endIdx);
}

/**
 * Expo config plugin 본체.
 *
 * @param {object} config Expo 설정 객체
 * @returns {object} 수정된 설정 객체
 */
const withIosDeploymentTarget = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return cfg;

      const before = fs.readFileSync(podfilePath, 'utf8');
      const after = injectPostInstall(before);
      if (after !== before) fs.writeFileSync(podfilePath, after);

      return cfg;
    },
  ]);

module.exports = withIosDeploymentTarget;
// 테스트에서 주입 로직만 따로 검증할 수 있게 노출한다.
module.exports.injectPostInstall = injectPostInstall;
module.exports.MIN_TARGET = MIN_TARGET;
