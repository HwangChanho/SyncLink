//
//  AppGroupBridge.swift
//
//  Native module that lets the React Native bundle write into an App Group
//  UserDefaults suite. The widget extension reads the same suite to render
//  today's events / due todos.
//
//  The module intentionally exposes the suite name as a parameter rather
//  than hard-coding it — keeps tests easier and matches the JS contract in
//  src/services/widgetDataService.ts.
//
//  Sprint 19 TASK-1900.
//

import Foundation
import React
#if canImport(WidgetKit)
import WidgetKit
#endif

@objc(AppGroupBridge)
class AppGroupBridge: NSObject {

  /// Persist a string into the named App Group's UserDefaults suite.
  /// - Parameters:
  ///   - suiteName: e.g. "group.io.synclink.app.widget"
  ///   - key: storage key (e.g. WIDGET_DATA_KEY in JS)
  ///   - value: serialized payload (we use JSON; opaque to this module)
  @objc(write:key:value:resolver:rejecter:)
  func write(_ suiteName: String,
             key: String,
             value: String,
             resolver: @escaping RCTPromiseResolveBlock,
             rejecter: @escaping RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      // The suite is unavailable when the App Group entitlement is missing
      // or mistyped. Surface a recognisable code so the JS side can log it.
      rejecter("E_NO_SUITE",
               "UserDefaults(suiteName: \(suiteName)) returned nil — check entitlements",
               nil)
      return
    }
    defaults.set(value, forKey: key)
    // Force a flush so the widget timeline (which may be sampled within
    // milliseconds when triggered by WidgetCenter) reads the latest bytes.
    defaults.synchronize()

    // Tell iOS to refresh every active widget for this app. WidgetCenter
    // is iOS 14+; the canImport guard keeps the file portable in case the
    // host project ever drops the deployment target.
    #if canImport(WidgetKit)
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
    #endif

    resolver(nil)
  }
}
