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

// Module is process-wide and stateless; no main-queue setup required.
+ (BOOL)requiresMainQueueSetup { return NO; }

@end
