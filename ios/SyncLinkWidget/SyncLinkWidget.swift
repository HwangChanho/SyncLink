//
//  SyncLinkWidget.swift
//
//  iOS / iPadOS home-screen widget for SyncLink. Reads a JSON snapshot
//  written by the host app (src/services/widgetDataService.ts via
//  AppGroupBridge) and renders today's events + due todos.
//
//  Architecture:
//    - Provider:    builds a Timeline of WidgetSnapshotEntry from the App
//                   Group UserDefaults suite. We use a single 30-min refresh
//                   so iOS can budget renders even when the host app isn't
//                   running; the host calls WidgetCenter.reloadAllTimelines()
//                   on actual data changes for instant updates.
//    - Entry:       decoded WidgetSnapshot (matches the JS contract).
//    - View:        SwiftUI layout, four families covering iPhone + iPad:
//                     small / medium / large / extraLarge (iPad).
//
//  Sprint 19 TASK-1900.
//

import WidgetKit
import SwiftUI

// MARK: - Shared constants

/// Must match `group.io.synclink.app.widget` from both entitlements files
/// and the JS-side AppGroupBridge.write() call.
private let APP_GROUP_SUITE = "group.io.synclink.app.widget"
private let WIDGET_DATA_KEY = "synclink.widgetSnapshot.v1"

// MARK: - Snapshot model (mirror of WidgetSnapshot in widgetDataService.ts)

private struct WidgetSnapshot: Decodable {
  let generatedAt: String
  let events: [WidgetEvent]
  let todos:  [WidgetTodo]
  let totals: Totals

  struct Totals: Decodable {
    let events: Int
    let todos:  Int
  }

  static let empty = WidgetSnapshot(
    generatedAt: "",
    events: [],
    todos: [],
    totals: Totals(events: 0, todos: 0)
  )
}

private struct WidgetEvent: Decodable, Identifiable {
  let id:        String
  let title:     String
  let startTime: String
  let color:     String
}

private struct WidgetTodo: Decodable, Identifiable {
  let id:      String
  let title:   String
  let dueDate: String?
  let overdue: Bool
}

// MARK: - TimelineEntry

struct SnapshotEntry: TimelineEntry {
  let date:     Date
  fileprivate let snapshot: WidgetSnapshot
}

// MARK: - Provider

struct Provider: TimelineProvider {

  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), snapshot: WidgetSnapshot.empty)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    completion(SnapshotEntry(date: Date(), snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let now = Date()
    let entry = SnapshotEntry(date: now, snapshot: loadSnapshot())
    let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }

  private func loadSnapshot() -> WidgetSnapshot {
    guard
      let defaults = UserDefaults(suiteName: APP_GROUP_SUITE),
      let raw = defaults.string(forKey: WIDGET_DATA_KEY),
      let data = raw.data(using: .utf8)
    else { return .empty }
    return (try? JSONDecoder().decode(WidgetSnapshot.self, from: data)) ?? .empty
  }
}

// MARK: - View

struct SyncLinkWidgetEntryView: View {
  let entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let snap = entry.snapshot
    VStack(alignment: .leading, spacing: 6) {
      header

      if snap.events.isEmpty && snap.todos.isEmpty {
        Spacer()
        Text("오늘 일정이 없어요")
          .font(.caption)
          .foregroundColor(.secondary)
        Spacer()
      } else {
        ForEach(Array(snap.events.prefix(eventLimit))) { evt in
          EventRow(event: evt)
        }

        if family != .systemSmall && !snap.todos.isEmpty {
          if !snap.events.isEmpty {
            Divider().padding(.vertical, 2)
          }
          ForEach(Array(snap.todos.prefix(todoLimit))) { td in
            TodoRow(todo: td)
          }
        }

        if snap.totals.events + snap.totals.todos > eventLimit + todoLimit {
          let overflow = (snap.totals.events + snap.totals.todos) - (eventLimit + todoLimit)
          Text("+\(overflow) more")
            .font(.caption2)
            .foregroundColor(.secondary)
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private var header: some View {
    HStack {
      Text("SyncLink")
        .font(.system(size: 12, weight: .semibold))
        .foregroundColor(.secondary)
      Spacer()
      Text(todayLabel)
        .font(.system(size: 11, weight: .medium))
        .foregroundColor(.secondary)
    }
  }

  private var todayLabel: String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "ko_KR")
    f.dateFormat = "M월 d일 (E)"
    return f.string(from: Date())
  }

  /// Density curve covering iPhone (small/medium/large) and iPad
  /// (extraLarge — typically 2× the cells of `large`). The exact
  /// numbers are tuned so each family fills its grid without empty space.
  private var eventLimit: Int {
    switch family {
      case .systemSmall:      return 2
      case .systemMedium:     return 3
      case .systemLarge:      return 5
      case .systemExtraLarge: return 8
      default:                return 4
    }
  }

  private var todoLimit: Int {
    switch family {
      case .systemSmall:      return 0
      case .systemMedium:     return 2
      case .systemLarge:      return 4
      case .systemExtraLarge: return 6
      default:                return 4
    }
  }
}

private struct EventRow: View {
  let event: WidgetEvent
  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(Color(hex: event.color))
        .frame(width: 6, height: 6)
      if !event.startTime.isEmpty {
        Text(event.startTime)
          .font(.system(size: 11, weight: .semibold, design: .monospaced))
          .foregroundColor(.secondary)
      }
      Text(event.title)
        .font(.system(size: 12))
        .lineLimit(1)
    }
  }
}

private struct TodoRow: View {
  let todo: WidgetTodo
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: todo.overdue ? "exclamationmark.circle.fill" : "circle")
        .font(.system(size: 10))
        .foregroundColor(todo.overdue ? .red : .secondary)
      Text(todo.title)
        .font(.system(size: 12))
        .lineLimit(1)
        .foregroundColor(todo.overdue ? .red : .primary)
    }
  }
}

// MARK: - Color hex helper

private extension Color {
  init(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else {
      self = .gray
      return
    }
    let r = Double((v >> 16) & 0xff) / 255
    let g = Double((v >>  8) & 0xff) / 255
    let b = Double( v        & 0xff) / 255
    self = Color(red: r, green: g, blue: b)
  }
}

// MARK: - Widget definition

@main
struct SyncLinkWidget: Widget {
  let kind = "SyncLinkWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      SyncLinkWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("SyncLink")
    .description("오늘의 일정과 마감 임박 할 일을 한눈에.")
    // .systemExtraLarge is iPad-only (iOS 15+). The system silently ignores
    // unsupported families on iPhone, so we can list them all together.
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
  }
}
