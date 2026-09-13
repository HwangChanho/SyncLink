# InstallSource — 앱이 어디서 설치됐는지(App Store / TestFlight / 시뮬레이터 / 기타)를 JS 에 알려 주는 로컬 Expo 모듈.
# 퍼널 기록의 build_channel 2단계(1.4.16)용 → src/lib/buildChannel.ts
# 🔴 fastlane beta 는 pod install 을 하지 않는다 — 이 모듈을 넣은 뒤 `cd ios && pod install` 을 직접 돌리고
#    Podfile.lock 에 InstallSource 가 들어갔는지 되읽어 확인할 것(reference_native_build_release).
Pod::Spec.new do |s|
  s.name           = 'InstallSource'
  s.version        = '1.0.0'
  s.summary        = 'App install source detection for funnel build_channel'
  s.description    = 'Exposes whether the app was installed from the App Store, TestFlight, a simulator, or another source.'
  s.author         = 'SyncLink'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
