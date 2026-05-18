//
//  SyncLinkWidget.swift
//
//  iOS home-screen widget for SyncLink. Two families:
//    - Small (158×158): today's events + first todo. Per-category colour
//      dot + shared-event nickname prefix. Tap → app.
//    - Large (338×354): monthly calendar grid (7 cols × 6 rows). Current
//      month dates normal, leading/trailing days dimmed. Today highlighted
//      with a filled accent disc. Each cell shows up to two coloured event
//      bars; overflow collapses to "+N". Tap → app.
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
  // Optional so older JSON payloads (Build ≤105) still decode. We fall back
  // to today's date and an empty owner so the small widget at least renders
  // the event row without disappearing.
  let dateKey:       String?
  let ownerNickname: String?
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
    let first  = todays.first
    let second = todays.count > 1 ? todays[1] : nil
    let firstTodo = snapshot.todos.first
    VStack(alignment: .leading, spacing: 4) {
      // Header row — date + brand. Always rendered so WidgetKit's gallery
      // preview can size the cell.
      HStack(spacing: 4) {
        Text(todayLabel())
          .font(.system(size: 11, weight: .semibold))
          .foregroundColor(.primary)
        Spacer(minLength: 0)
        Text("SyncLink")
          .font(.system(size: 9, weight: .medium))
          .foregroundColor(.secondary)
      }

      // Three reserved rows. Filling with placeholders when data is sparse
      // — earlier `Spacer/Spacer` sandwich + ForEach collapsed on small
      // and caused iOS to hide the family from the gallery preview.
      if let evt = first {
        EventRow(event: evt, compact: true)
      } else {
        Text("오늘 일정 없음")
          .font(.system(size: 11))
          .foregroundColor(.secondary)
      }
      if let evt = second {
        EventRow(event: evt, compact: true)
      }
      if let td = firstTodo {
        TodoRow(todo: td)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Large (338×354) — Monthly calendar grid (7 cols × 6 rows)

private struct LargeView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      // Header — yyyy.MM and short hint, mirrors Naver Calendar widget style.
      HStack {
        Text(monthHeaderLabel())
          .font(.system(size: 15, weight: .bold))
        Spacer()
        Text("\(snapshot.totals.events)개 일정")
          .font(.system(size: 10))
          .foregroundColor(.secondary)
      }
      WeekdayHeader()
      MonthGrid(events: snapshot.events)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Weekday header row (일~토, 일=red / 토=blue)

private struct WeekdayHeader: View {
  private static let labels = ["일", "월", "화", "수", "목", "금", "토"]

  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<7, id: \.self) { i in
        Text(Self.labels[i])
          .font(.system(size: 10, weight: .medium))
          .frame(maxWidth: .infinity)
          .foregroundColor(weekdayColor(i))
      }
    }
  }

  private func weekdayColor(_ i: Int) -> Color {
    if i == 0 { return Color.red.opacity(0.85) }
    if i == 6 { return Color.blue.opacity(0.85) }
    return .secondary
  }
}

// MARK: - 6 × 7 month grid

private struct MonthGrid: View {
  let events: [WidgetEvent]

  var body: some View {
    let days = monthGridDays()
    // 6 rows × 7 cols. Equal-spaced columns; vertical spacing creates the
    // whitespace LEAD asked for (네이버 캘린더 위젯 reference).
    VStack(spacing: 4) {
      ForEach(0..<6, id: \.self) { row in
        HStack(spacing: 4) {
          ForEach(0..<7, id: \.self) { col in
            let idx = row * 7 + col
            DayCell(date: days[idx], events: events)
          }
        }
      }
    }
  }

  /// 6 weeks starting at the Sunday on or before the 1st of the current month.
  private func monthGridDays() -> [Date] {
    let cal = Calendar.current
    let now = Date()
    let comps = cal.dateComponents([.year, .month], from: now)
    guard let monthFirst = cal.date(from: comps) else { return [] }
    let weekdayOfFirst = cal.component(.weekday, from: monthFirst) // 1=Sun
    let gridStart = cal.date(byAdding: .day, value: -(weekdayOfFirst - 1), to: monthFirst) ?? monthFirst
    return (0..<42).compactMap { cal.date(byAdding: .day, value: $0, to: gridStart) }
  }
}

// MARK: - Single day cell

private struct DayCell: View {
  let date:   Date
  let events: [WidgetEvent]

  var body: some View {
    let key = dateKeyFor(date)
    let today = dateKeyFor(Date())
    let isToday = key == today
    let inCurrentMonth = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .month)
    let dayEvents = events.filter { ($0.dateKey ?? today) == key }

    VStack(alignment: .leading, spacing: 2) {
      // Day number — today highlighted with a filled accent disc.
      HStack {
        if isToday {
          Text("\(Calendar.current.component(.day, from: date))")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white)
            .frame(width: 16, height: 16)
            .background(Circle().fill(Color.accentColor))
        } else {
          Text("\(Calendar.current.component(.day, from: date))")
            .font(.system(size: 11, weight: inCurrentMonth ? .semibold : .regular))
            .foregroundColor(dayNumberColor(date: date, inCurrentMonth: inCurrentMonth))
        }
        Spacer(minLength: 0)
      }

      // Up to 2 event bars; further events collapse to "+N".
      ForEach(Array(dayEvents.prefix(2))) { evt in
        EventBar(event: evt)
      }
      if dayEvents.count > 2 {
        Text("+\(dayEvents.count - 2)")
          .font(.system(size: 8, weight: .medium))
          .foregroundColor(.secondary)
          .padding(.leading, 2)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func dayNumberColor(date: Date, inCurrentMonth: Bool) -> Color {
    let weekday = Calendar.current.component(.weekday, from: date)
    let base: Color = {
      if weekday == 1 { return .red }
      if weekday == 7 { return .blue }
      return .primary
    }()
    return inCurrentMonth ? base : base.opacity(0.35)
  }

  private func dateKeyFor(_ d: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: d)
  }
}

// MARK: - Event bar inside a cell (coloured pill with truncated title)

private struct EventBar: View {
  let event: WidgetEvent
  var body: some View {
    Text(displayTitle)
      .font(.system(size: 8, weight: .medium))
      .lineLimit(1)
      .truncationMode(.tail)
      .foregroundColor(.white)
      .padding(.horizontal, 3)
      .padding(.vertical, 1)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 2)
          .fill(Color(hex: event.color).opacity(0.85))
      )
  }
  private var displayTitle: String {
    event.title
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
    let nick = event.ownerNickname ?? ""
    return nick.isEmpty ? event.title : "\(nick) · \(event.title)"
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
  // dateKey nil → 옛 JSON 호환 fallback: 모든 이벤트를 today 로 간주.
  return snap.events.filter { ($0.dateKey ?? today) == today }
}

private func todayLabel() -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "ko_KR")
  f.dateFormat = "M/d (E)"
  return f.string(from: Date())
}

private func monthHeaderLabel() -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "ko_KR")
  f.dateFormat = "yyyy.MM"
  return f.string(from: Date())
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
    .description("작은 위젯은 오늘 일정과 할 일을, 큰 위젯은 이번 달 달력을 보여줍니다.")
    // iPad supportsTablet=false 인 v1.0 — extraLarge 제외. Medium 도
    // 사용자 요구로 제거 (small + large 만 노출).
    .supportedFamilies([.systemSmall, .systemLarge])
  }
}
