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

  /// Read a string back out of the App Group suite.
  ///
  /// Needed for the widget → app direction. A WidgetKit App Intent runs inside
  /// the widget extension where no JS and no Supabase session exist, so it can
  /// only queue the user's checkbox taps into the shared suite; the app drains
  /// that queue on launch and this is how it gets at it.
  ///
  /// Resolves `nil` (not an error) when the key is absent — an empty queue is
  /// the normal case on almost every launch.
  @objc(read:key:resolver:rejecter:)
  func read(_ suiteName: String,
            key: String,
            resolver: @escaping RCTPromiseResolveBlock,
            rejecter: @escaping RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      rejecter("E_NO_SUITE",
               "UserDefaults(suiteName: \(suiteName)) returned nil — check entitlements",
               nil)
      return
    }
    resolver(defaults.string(forKey: key))
  }

  /// Delete a key from the App Group suite.
  ///
  /// Used to clear the pending-toggle queue *after* the app has successfully
  /// replayed it. Kept separate from `write("")` so an empty string and an
  /// absent key never have to mean the same thing.
  @objc(remove:key:resolver:rejecter:)
  func remove(_ suiteName: String,
              key: String,
              resolver: @escaping RCTPromiseResolveBlock,
              rejecter: @escaping RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      rejecter("E_NO_SUITE",
               "UserDefaults(suiteName: \(suiteName)) returned nil — check entitlements",
               nil)
      return
    }
    defaults.removeObject(forKey: key)
    defaults.synchronize()
    resolver(nil)
  }
}
