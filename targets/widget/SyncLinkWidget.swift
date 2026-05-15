//
//  SyncLinkWidget.swift
//
//  iOS home-screen widget for SyncLink. Two families:
//    - Small (158×158): today's events + first todo. Per-category colour
//      dot + shared-event nickname prefix. Tap → app.
//    - Large (338×354): weekly grid (7 columns, today highlighted) showing
//      each day's event colour dots, plus today's event/todo list on the
//      right. Tap → app.
//
//  Apple does not allow ScrollView/swipe in WidgetKit (iOS 17 only adds
//  Button/Toggle via App Intents). View-mode switching happens by changing
//  the widget size from the long-press menu.
//
//  Data is fed from the host app's widgetDataService.ts via App Group
//  UserDefaults (suite `group.io.synclink.app.widget`).
//
//  Sprint 19 TASK-1900 (initial), 2026-05-15 rework (small + large only,
//  weekly grid, shared prefix, per-category colours).
//

import WidgetKit
import SwiftUI

// MARK: - Shared constants

// Wrapped in a caseless enum so the file contains no top-level bindings,
// which keeps `@main` happy under stricter Swift toolchains.
private enum WidgetConfig {
  static let appGroupSuite = "group.io.synclink.app.widget"
  static let widgetDataKey = "synclink.widgetSnapshot.v1"
}

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
  let id:            String
  let title:         String
  let startTime:     String
  let color:         String
  let dateKey:       String   // YYYY-MM-DD
  let ownerNickname: String   // "" for own events
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
    // 30-minute reload as a baseline; the host app calls
    // WidgetCenter.reloadAllTimelines() on real changes for instant updates.
    let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }

  private func loadSnapshot() -> WidgetSnapshot {
    guard
      let defaults = UserDefaults(suiteName: WidgetConfig.appGroupSuite),
      let raw = defaults.string(forKey: WidgetConfig.widgetDataKey),
      let data = raw.data(using: .utf8)
    else { return .empty }
    return (try? JSONDecoder().decode(WidgetSnapshot.self, from: data)) ?? .empty
  }
}

// MARK: - Entry root view

struct SyncLinkWidgetEntryView: View {
  let entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let snap = entry.snapshot
    switch family {
    case .systemLarge:
      LargeView(snapshot: snap)
        .padding(12)
    default:
      SmallView(snapshot: snap)
        .padding(12)
    }
  }
}

// MARK: - Small (158×158)

private struct SmallView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    let todays = todayEvents(snapshot)
    let totalRows = todays.count + snapshot.todos.count
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 4) {
        Text(todayLabel())
          .font(.system(size: 11, weight: .semibold))
          .foregroundColor(.primary)
        Spacer(minLength: 0)
      }

      if totalRows == 0 {
        // Pin the empty-state label flush with the header so iOS WidgetKit
        // can always size the small layout — earlier Spacer/Spacer sandwich
        // sometimes collapsed the view in the gallery preview.
        Text("오늘 일정 없음")
          .font(.system(size: 11))
          .foregroundColor(.secondary)
        Spacer(minLength: 0)
      } else {
        ForEach(Array(todays.prefix(2))) { evt in
          EventRow(event: evt, compact: true)
        }
        ForEach(Array(snapshot.todos.prefix(1))) { td in
          TodoRow(todo: td)
        }
        if snapshot.totals.events + snapshot.totals.todos > 3 {
          let extra = (snapshot.totals.events + snapshot.totals.todos) - 3
          Text("+\(extra) more")
            .font(.system(size: 9))
            .foregroundColor(.secondary)
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Large (338×354) — Weekly grid + today list

private struct LargeView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("이번 주")
          .font(.system(size: 14, weight: .semibold))
        Spacer()
        Text(weekRangeLabel())
          .font(.system(size: 11))
          .foregroundColor(.secondary)
      }

      WeekGrid(events: snapshot.events)
        .frame(height: 110)

      Divider().padding(.vertical, 1)

      // Today list (shares the right side conceptually; here we stack
      // it below the grid for clean readability inside 338×354).
      let todays = todayEvents(snapshot)
      if todays.isEmpty && snapshot.todos.isEmpty {
        Text("오늘 일정 없음")
          .font(.caption)
          .foregroundColor(.secondary)
      } else {
        VStack(alignment: .leading, spacing: 3) {
          ForEach(Array(todays.prefix(3))) { evt in
            EventRow(event: evt, compact: false)
          }
          if !snapshot.todos.isEmpty {
            if !todays.isEmpty { Spacer().frame(height: 2) }
            ForEach(Array(snapshot.todos.prefix(2))) { td in
              TodoRow(todo: td)
            }
          }
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Weekly grid sub-view

private struct WeekGrid: View {
  let events: [WidgetEvent]

  private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]

  var body: some View {
    let days = next7Days()
    HStack(alignment: .top, spacing: 4) {
      ForEach(0..<days.count, id: \.self) { idx in
        let d = days[idx]
        let key = dateKey(d)
        let dayEvents = events.filter { $0.dateKey == key }
        let isToday = key == dateKey(Date())
        VStack(spacing: 2) {
          Text(Self.weekdays[Calendar.current.component(.weekday, from: d) - 1])
            .font(.system(size: 9, weight: .medium))
            .foregroundColor(.secondary)
          ZStack {
            if isToday {
              Circle().fill(Color.accentColor.opacity(0.2)).frame(width: 22, height: 22)
            }
            Text("\(Calendar.current.component(.day, from: d))")
              .font(.system(size: 12, weight: isToday ? .semibold : .regular))
          }
          VStack(spacing: 2) {
            ForEach(Array(dayEvents.prefix(3))) { evt in
              Circle()
                .fill(Color(hex: evt.color))
                .frame(width: 5, height: 5)
            }
            if dayEvents.count > 3 {
              Text("+\(dayEvents.count - 3)")
                .font(.system(size: 8))
                .foregroundColor(.secondary)
            }
          }
        }
        .frame(maxWidth: .infinity)
      }
    }
  }

  private func next7Days() -> [Date] {
    let cal = Calendar.current
    let start = cal.startOfDay(for: Date())
    return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
  }

  private func dateKey(_ d: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: d)
  }
}

// MARK: - Row sub-views

private struct EventRow: View {
  let event: WidgetEvent
  let compact: Bool
  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(Color(hex: event.color))
        .frame(width: compact ? 6 : 7, height: compact ? 6 : 7)
      if !event.startTime.isEmpty {
        Text(event.startTime)
          .font(.system(size: compact ? 10 : 11, weight: .semibold, design: .monospaced))
          .foregroundColor(.secondary)
      }
      Text(displayTitle)
        .font(.system(size: compact ? 11 : 12))
        .lineLimit(1)
    }
  }
  private var displayTitle: String {
    event.ownerNickname.isEmpty
      ? event.title
      : "\(event.ownerNickname) · \(event.title)"
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
        .font(.system(size: 11))
        .lineLimit(1)
        .foregroundColor(todo.overdue ? .red : .primary)
    }
  }
}

// MARK: - Helpers

private func todayEvents(_ snap: WidgetSnapshot) -> [WidgetEvent] {
  let today = todayKey()
  return snap.events.filter { $0.dateKey == today }
}

private func todayLabel() -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "ko_KR")
  f.dateFormat = "M/d (E)"
  return f.string(from: Date())
}

private func weekRangeLabel() -> String {
  let cal = Calendar.current
  let start = cal.startOfDay(for: Date())
  let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
  let f = DateFormatter()
  f.locale = Locale(identifier: "ko_KR")
  f.dateFormat = "M/d"
  return "\(f.string(from: start)) ~ \(f.string(from: end))"
}

private func todayKey() -> String {
  let f = DateFormatter()
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: Date())
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
    .description("작은 위젯은 오늘 일정과 할 일을, 큰 위젯은 이번 주 달력을 보여줍니다.")
    // iPad supportsTablet=false 인 v1.0 — extraLarge 제외. Medium 도
    // 사용자 요구로 제거 (small + large 만 노출).
    .supportedFamilies([.systemSmall, .systemLarge])
  }
}
