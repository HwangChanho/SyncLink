import ExpoModulesCore

/**
 * InstallSourceModule — 이 앱이 **어디서 설치됐는지**를 상수로 노출한다.
 *
 * 왜 필요한가(2026-09-13): 퍼널 기록의 build_channel 1단계(JS)는 TestFlight 와 App Store 를
 * 가르지 못했다 — fastlane 이 올린 **같은 바이너리**가 TestFlight 를 거쳐 그대로 출시되므로
 * 빌드 시점에 값을 박을 수 없다. 설치된 뒤 **실행 환경에서만** 구분된다.
 *
 * 반환값(`installSource`):
 *  - "simulator"  : iOS 시뮬레이터(컴파일 조건으로 확정)
 *  - "testflight" : 영수증 파일명이 `sandboxReceipt` — TestFlight·샌드박스 설치의 표식
 *  - "sideload"   : `embedded.mobileprovision` 이 번들에 있음 — 개발/애드혹 서명(스토어는 이 파일을 벗겨 낸다)
 *  - "app_store"  : 위 어느 것도 아님 = 스토어 설치
 *
 * ⚠️ `appStoreReceiptURL` 은 iOS 18 에서 deprecated 지만 동작한다. StoreKit 2 의
 *    `AppTransaction.environment` 는 iOS 16+ 비동기라 **동기 상수**로 못 준다(최소 iOS 15.1).
 *    JS 쪽이 동기 판별이라 여기서도 동기로 끝낸다.
 */
public class InstallSourceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("InstallSource")

    // 실행 중 바뀌지 않는 값이라 상수로 한 번만 계산한다.
    Constant("installSource") {
      InstallSourceModule.detect()
    }
  }

  /// 설치 출처를 판별한다. 확실한 신호부터 순서대로 본다.
  static func detect() -> String {
    #if targetEnvironment(simulator)
    return "simulator"
    #else
    // ① TestFlight: 샌드박스 영수증 경로. App Store 설치는 "receipt" 다.
    if Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" {
      return "testflight"
    }
    // ② 개발/애드혹 서명: 프로비저닝 프로파일이 번들에 남아 있다(App Store·TestFlight 배포본에는 없다).
    if Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil {
      return "sideload"
    }
    // ③ 나머지 = App Store
    return "app_store"
    #endif
  }
}
