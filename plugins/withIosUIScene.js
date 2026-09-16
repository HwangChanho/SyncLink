/**
 * withIosUIScene — iOS **UIScene 생명주기**를 채택한다.
 *
 * 왜 필요한가 (2026-09-16):
 *   🔴 **iOS 27 SDK(Xcode 27)로 빌드한 앱은 UIScene 을 채택하지 않으면 실행 즉시 죽는다.**
 *     ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption / EXC_BREAKPOINT
 *   형제 프로젝트가 iOS 27 실기기에서 실제로 겪었고, 우리 1.4.17(build 188)도 같은 조건이라
 *   심사를 취소했다. iOS 26 이하 SDK 로 빌드한 바이너리(1.4.16 등)는 영향이 없다.
 *
 * 🔑 React Native·Expo 는 자체 SceneDelegate 를 제공하지 않는다(Expo 57 / RN 0.86 에서도 구현 0건).
 *    그래서 **앱이 직접** 써야 한다.
 *
 * 🔴 왜 plugin 인가: `ios/` 는 .gitignore 대상이라 직접 수정은 커밋되지 않고 `expo prebuild` 가
 *    되돌린다. [[withIosDeploymentTarget]] 과 같은 이유다.
 *
 * 하는 일 (둘 다 멱등):
 *   ① Info.plist 에 `UIApplicationSceneManifest` 주입
 *   ② AppDelegate.swift 에서 window 생성/`startReactNative` 를 걷어내고 `SceneDelegate` 를 덧붙인다
 *      (별도 파일로 두면 pbxproj 에 파일 참조를 추가해야 하므로 같은 파일에 넣는다 —
 *       Swift 는 한 파일에 여러 타입을 허용한다)
 */

const { withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** 이미 주입됐는지 판정하는 표식. 🔴 정규식 특수문자를 넣지 말 것(멱등성이 깨진다). */
const MARKER = 'class SceneDelegate';

/** AppDelegate 에 덧붙일 SceneDelegate 구현. */
const SCENE_DELEGATE = `

// MARK: - SceneDelegate (withIosUIScene plugin 주입)
//
// 🔴 iOS 27 SDK 로 빌드한 앱은 UIScene 생명주기를 채택하지 않으면 실행 즉시 trap 으로 죽는다.
//    RN·Expo 가 SceneDelegate 를 제공하지 않아 앱이 직접 쓴다.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    // ⚠️ UIWindow(windowScene:) 이어야 한다. UIWindow(frame:) 은 scene 에 안 붙어 화면이 안 그려진다.
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // ⚠️ AppDelegate.window 에도 대입 — reanimated(키보드)·광고 SDK·ASWebAuthenticationSession 의
    //    presentationAnchor 가 delegate.window 를 읽는다(소셜 로그인 창).
    appDelegate.window = window

    // ⚠️ RN 의 Linking.getInitialURL() 은 launchOptions 만 본다.
    let launchOptions = Self.launchOptions(from: connectionOptions)
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
    window.makeKeyAndVisible()

    // 콜드 스타트 딥링크·유니버설 링크를 AppDelegate 경로로 흘려보낸다(빠뜨리면 조용히 사라진다).
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    for activity in connectionOptions.userActivities {
      self.scene(scene, continue: activity)
    }
  }

  // 앱이 떠 있는 상태의 딥링크 — AppDelegate 처리를 그대로 탄다(카카오 콜백·RCTLinkingManager 포함).
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(
        UIApplication.shared,
        open: context.url,
        options: Self.openURLOptions(from: context.options)
      )
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity) { _ in }
  }

  // ⚠️ scene 채택 시 UIKit 은 AppDelegate 의 생명주기 메서드를 부르지 않는다.
  //    Expo 구독자(ExpoAppDelegateSubscriberManager)가 거기 붙어 있으므로 손수 넘긴다.
  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }
  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }
  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }
  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  static func openURLOptions(from options: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
    var result: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let source = options.sourceApplication { result[.sourceApplication] = source }
    if let annotation = options.annotation { result[.annotation] = annotation }
    result[.openInPlace] = options.openInPlace
    return result
  }

  static func launchOptions(from connectionOptions: UIScene.ConnectionOptions) -> [AnyHashable: Any] {
    var options: [AnyHashable: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      options[UIApplication.LaunchOptionsKey.url] = url
    }
    if let activity = connectionOptions.userActivities.first {
      var dict: [String: Any] = [:]
      dict[UIApplication.LaunchOptionsKey.userActivityType.rawValue] = activity.activityType
      // 🔑 RCTLinkingManager 는 이 문자열 키로 읽는다(상수가 따로 없다).
      dict["UIApplicationLaunchOptionsUserActivityKey"] = activity
      options[UIApplication.LaunchOptionsKey.userActivityDictionary] = dict
    }
    return options
  }
}
`;

/**
 * AppDelegate.swift 를 UIScene 방식으로 고친다.
 *
 * @param {string} contents 원본 소스
 * @returns {string} 수정본. 이미 적용돼 있으면 원본 그대로.
 */
function transformAppDelegate(contents) {
  if (contents.includes(MARKER)) return contents; // 멱등

  let out = contents;

  // ① UIKit import (SceneDelegate 가 UIWindowSceneDelegate·UIWindow 를 쓴다)
  if (!/^import UIKit$/m.test(out)) {
    out = out.replace(
      /^(import ReactAppDependencyProvider)$/m,
      '$1\nimport UIKit  // SceneDelegate 용 — withIosUIScene plugin'
    );
  }

  // ② window 생성 + startReactNative 제거.
  //    여기서 창을 또 만들면 **창이 둘이 되어 화면이 겹친다.**
  out = out.replace(
    /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\([\s\S]*?\)\s*\n#endif\s*\n/m,
    '    // window 생성과 startReactNative 는 SceneDelegate 로 옮겼다(withIosUIScene plugin).\n' +
      '    // 여기서 다시 만들면 창이 둘이 되어 화면이 겹친다.\n\n'
  );

  // ③ SceneDelegate 를 파일 끝에 덧붙인다
  out = out.trimEnd() + '\n' + SCENE_DELEGATE;

  return out;
}

const withIosUIScene = (config) => {
  // ① Info.plist — UIApplicationSceneManifest
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  // ② AppDelegate.swift
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const dir = cfg.modRequest.platformProjectRoot;
      // prebuild 가 만드는 경로: ios/<프로젝트명>/AppDelegate.swift
      const candidates = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(dir, d.name, 'AppDelegate.swift'))
        .filter((p) => fs.existsSync(p));

      for (const file of candidates) {
        const before = fs.readFileSync(file, 'utf8');
        const after = transformAppDelegate(before);
        if (after !== before) fs.writeFileSync(file, after);
      }
      return cfg;
    },
  ]);

  return config;
};

module.exports = withIosUIScene;
// 테스트에서 변환 로직만 따로 검증할 수 있게 노출한다.
module.exports.transformAppDelegate = transformAppDelegate;
module.exports.MARKER = MARKER;
