//
//  AppGroupBridge.m
//
//  Objective-C interface declaration for the AppGroupBridge native module.
//  Implementation lives in AppGroupBridge.swift (exposed via the existing
//  SyncLink-Bridging-Header.h).
//
//  Sprint 19 TASK-1900 — bridges JS (widgetDataService.ts) → iOS App Group
//  UserDefaults so the SwiftUI widget extension can read shared state.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppGroupBridge, NSObject)

// Writes a string value into the App Group UserDefaults suite.
// JS contract: AppGroupBridge.write(suiteName, key, value) -> Promise<void>
RCT_EXTERN_METHOD(write:(NSString *)suiteName
                  key:(NSString *)key
                  value:(NSString *)value
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Reads a string back out — the widget → app direction, used to drain the
// pending-toggle queue an App Intent left behind.
// JS contract: AppGroupBridge.read(suiteName, key) -> Promise<string | null>
RCT_EXTERN_METHOD(read:(NSString *)suiteName
                  key:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Clears a key, called only after the queue has been replayed successfully.
// JS contract: AppGroupBridge.remove(suiteName, key) -> Promise<void>
RCT_EXTERN_METHOD(remove:(NSString *)suiteName
                  key:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Module is process-wide and stateless; no main-queue setup required.
+ (BOOL)requiresMainQueueSetup { return NO; }

@end
