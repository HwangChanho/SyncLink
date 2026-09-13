package expo.modules.installsource

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * InstallSourceModule — 이 앱을 **누가 설치했는지**(설치 주체 패키지)를 상수로 노출한다.
 *
 * 왜 필요한가(2026-09-13): 퍼널 기록의 build_channel 1단계(JS)는 Play 설치와
 * 내부 배포 APK(사이드로드)를 가르지 못했다. 설치 주체는 네이티브에서만 읽힌다.
 *
 * 반환값(`installSource`):
 *  - "play"        : 설치 주체가 Google Play(com.android.vending) — 프로덕션·테스트 트랙 모두 여기
 *  - "sideload"    : 설치 주체 없음 — adb·파일 설치(내부 APK·개발 빌드)
 *  - "other_store" : 다른 스토어(삼성 갤럭시 스토어 등)
 *  - "unknown"     : 조회 실패 — JS 는 이 값을 "모름"으로 보고 release 로 둔다
 *
 * 에뮬레이터 판별은 JS(buildChannel.isAndroidEmulator)가 맡는다 — Build 상수는 RN 이 이미 싣는다.
 */
class InstallSourceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InstallSource")

    // 실행 중 바뀌지 않으므로 상수로 한 번만 계산한다.
    Constant("installSource") {
      detect()
    }
  }

  /** 설치 주체 패키지명으로 출처를 판별한다. 어떤 예외도 밖으로 내보내지 않는다. */
  private fun detect(): String {
    val context = appContext.reactContext ?: return "unknown"
    val installer: String? = try {
      val pm = context.packageManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // API 30+: 공식 API. 설치 주체(installingPackageName)를 준다.
        pm.getInstallSourceInfo(context.packageName).installingPackageName
      } else {
        // API 24~29: 대체 API 가 없어 deprecated 메서드를 쓴다.
        @Suppress("DEPRECATION")
        pm.getInstallerPackageName(context.packageName)
      }
    } catch (e: Exception) {
      return "unknown"
    }
    return when (installer) {
      "com.android.vending" -> "play"
      null -> "sideload"
      else -> "other_store"
    }
  }
}
