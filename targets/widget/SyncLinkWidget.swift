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
import AppIntents

// MARK: - Shared constants

// Wrapped in a caseless enum so the file contains no top-level bindings,
// which keeps `@main` happy under stricter Swift toolchains.
private enum WidgetConfig {
  static let appGroupSuite = "group.io.synclink.app.widget"
  static let widgetDataKey = "synclink.widgetSnapshot.v1"
  /// v2 adds `done` on todos. Read first, with v1 as fallback so a widget that
  /// wakes up before the updated app has written v2 still renders.
  static let widgetDataKeyV2 = "synclink.widgetSnapshot.v2"
  /// Checkbox taps waiting for the app to push them to Supabase.
  /// The extension has no session, so queueing here is the only option.
  static let pendingTogglesKey = "synclink.widgetPendingToggles.v1"
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
  /// Optional because v1 payloads (and any build before the checkbox feature)
  /// don't carry it. Absent means "not done" — v1 only ever emitted pending todos.
  let done:    Bool?

  var isDone: Bool { done ?? false }

  /// Copy with a flipped completion state, used to paint a queued tap
  /// optimistically before the app has synced it.
  func withDone(_ value: Bool) -> WidgetTodo {
    WidgetTodo(id: id, title: title, dueDate: dueDate, overdue: overdue, done: value)
  }
}

// MARK: - Pending toggle queue (widget → app)

/// One checkbox tap recorded in the widget extension.
private struct PendingToggle: Codable {
  let todoId: String
  let done:   Bool
  /// ISO8601 timestamp — the app resolves duplicates by taking the latest.
  let at:     String
}

/// Read/append the queue the app drains on launch.
///
/// Why a queue at all: an App Intent runs inside the widget extension, which has
/// no JS runtime and no Supabase session. It cannot write to the server itself,
/// so it records intent here and the app replays it
/// (`drainWidgetPendingToggles` in widgetDataService.ts).
private enum PendingToggleStore {

  static func load() -> [PendingToggle] {
    guard
      let defaults = UserDefaults(suiteName: WidgetConfig.appGroupSuite),
      let raw = defaults.string(forKey: WidgetConfig.pendingTogglesKey),
      let data = raw.data(using: .utf8)
    else { return [] }
    return (try? JSONDecoder().decode([PendingToggle].self, from: data)) ?? []
  }

  static func append(todoId: String, done: Bool) {
    guard let defaults = UserDefaults(suiteName: WidgetConfig.appGroupSuite) else { return }
    var queue = load()
    let stamp = ISO8601DateFormatter().string(from: Date())
    queue.append(PendingToggle(todoId: todoId, done: done, at: stamp))
    guard
      let data = try? JSONEncoder().encode(queue),
      let json = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(json, forKey: WidgetConfig.pendingTogglesKey)
    defaults.synchronize()
  }

  /// Latest desired state per todo. Several taps on one row collapse to the last.
  static func latestByTodo() -> [String: Bool] {
    var result: [String: Bool] = [:]
    var stamps: [String: String] = [:]
    for t in load() {
      if let prev = stamps[t.todoId], prev > t.at { continue }
      stamps[t.todoId] = t.at
      result[t.todoId] = t.done
    }
    return result
  }
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
    guard let defaults = UserDefaults(suiteName: WidgetConfig.appGroupSuite) else { return .empty }

    // v2 first (has `done`), v1 as fallback for the window between an app
    // update and its first snapshot write.
    var decoded: WidgetSnapshot?
    for key in [WidgetConfig.widgetDataKeyV2, WidgetConfig.widgetDataKey] {
      if
        let raw = defaults.string(forKey: key),
        let data = raw.data(using: .utf8),
        let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
      {
        decoded = snap
        break
      }
    }
    guard let snapshot = decoded else { return .empty }

    return applyPendingToggles(to: snapshot)
  }

  /// Paint queued taps on top of the stored snapshot.
  ///
  /// Without this the checkbox would spring back the moment WidgetKit redraws:
  /// the tap only lives in the queue until the app next runs, and the snapshot
  /// on disk still says the todo is pending.
  private func applyPendingToggles(to snapshot: WidgetSnapshot) -> WidgetSnapshot {
    let pending = PendingToggleStore.latestByTodo()
    guard !pending.isEmpty else { return snapshot }
    let todos = snapshot.todos.map { todo -> WidgetTodo in
      guard let want = pending[todo.id], want != todo.isDone else { return todo }
      return todo.withDone(want)
    }
    return WidgetSnapshot(
      generatedAt: snapshot.generatedAt,
      events: snapshot.events,
      todos: todos,
      totals: snapshot.totals
    )
  }
}

// MARK: - App Intent (iOS 17+) — tapping a checkbox inside the widget

/// Records a checkbox tap and asks WidgetKit to redraw.
///
/// iOS 17 is the floor for interactive widgets (`Button(intent:)`); on iOS 16
/// the rows fall back to plain text and tapping opens the app instead. The
/// widget target's deployment target stays at 16.0 so those users keep the
/// widget — they just can't tick from it.
@available(iOS 17.0, *)
struct ToggleTodoIntent: AppIntent {
  static var title: LocalizedStringResource = "할 일 완료 표시"
  /// Keep the app closed — the whole point is ticking without launching.
  static var openAppWhenRun: Bool = false

  @Parameter(title: "todoId") var todoId: String
  @Parameter(title: "done")   var done: Bool

  init() {}

  init(todoId: String, done: Bool) {
    self.todoId = todoId
    self.done = done
  }

  func perform() async throws -> some IntentResult {
    PendingToggleStore.append(todoId: todoId, done: done)
    // Redraw so applyPendingToggles picks the tap up immediately.
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
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
      // The month grid moved to its own kind (SyncLinkCalendarWidget); this
      // kind is the todo widget at every size now.
      LargeTodoView(snapshot: snap)
        // v1.3.1 — LEAD: "위/아래 좌/우 padding 동일하게".
        .padding(16)
    default:
      SmallView(snapshot: snap)
        .padding(16)
    }
  }
}

// MARK: - Large 투두형 — today's events, then checkable todos

private struct LargeTodoView: View {
  let snapshot: WidgetSnapshot

  var body: some View {
    let events = Array(todayEvents(snapshot).prefix(4))
    let todos  = Array(snapshot.todos.prefix(5))

    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(todayLabel())
          .font(.system(size: 15, weight: .bold))
        Spacer()
        Text("SyncLink")
          .font(.system(size: 10))
          .foregroundColor(.secondary)
      }

      if events.isEmpty {
        Text("오늘 일정 없음")
          .font(.system(size: 12))
          .foregroundColor(.secondary)
      } else {
        ForEach(events) { EventRow(event: $0, compact: false) }
      }

      if !todos.isEmpty {
        Divider().padding(.vertical, 2)
        ForEach(todos) { TodoRow(todo: $0) }
      }

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
    // v1.3.1 — 위/아래 시각 균형: top/bottom 에 동등하게 spacer 분배해
    // grid 가 위젯 중앙에 자리 잡도록. 기존엔 bottom Spacer 만 있어 grid 가
    // 상단으로 압축되고 상단 padding 이 좁아 보이던 회귀.
    VStack(alignment: .leading, spacing: 8) {
      Spacer(minLength: 0)
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
  /// Larger type + tap target for the 체크형 widget, which exists to be tapped.
  var prominent: Bool = false

  var body: some View {
    HStack(spacing: 6) {
      if #available(iOS 17.0, *) {
        // Interactive: the tap is handled entirely inside the extension.
        Button(intent: ToggleTodoIntent(todoId: todo.id, done: !todo.isDone)) {
          checkboxIcon
        }
        .buttonStyle(.plain)
      } else {
        // iOS 16 and below have no Button(intent:) — the row still shows state,
        // and tapping anywhere falls through to the widget's default deep link.
        checkboxIcon
      }
      Text(todo.title)
        .font(.system(size: prominent ? 13 : 11))
        .lineLimit(prominent ? 2 : 1)
        .strikethrough(todo.isDone, color: .secondary)
        .foregroundColor(titleColor)
    }
  }

  private var checkboxIcon: some View {
    Image(systemName: iconName)
      .font(.system(size: prominent ? 18 : 12))
      .foregroundColor(iconColor)
      // Pad the glyph out toward a thumb-sized target; SF Symbols at 12pt are
      // far below Apple's 44pt guidance on their own.
      .padding(prominent ? 4 : 2)
      .contentShape(Rectangle())
  }

  private var iconName: String {
    if todo.isDone { return "checkmark.square.fill" }
    return todo.overdue ? "exclamationmark.square" : "square"
  }

  private var iconColor: Color {
    if todo.isDone { return .accentColor }
    return todo.overdue ? .red : .secondary
  }

  private var titleColor: Color {
    if todo.isDone { return .secondary }
    return todo.overdue ? .red : .primary
  }
}

// MARK: - 체크형 (check) — todos only, thumb-sized rows

private struct CheckView: View {
  let snapshot: WidgetSnapshot
  let limit: Int

  var body: some View {
    let todos = Array(snapshot.todos.prefix(limit))
    let remaining = max(0, snapshot.totals.todos - todos.count)

    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("할 일")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.secondary)
        Spacer(minLength: 0)
        if remaining > 0 {
          Text("+\(remaining)")
            .font(.system(size: 10))
            .foregroundColor(.secondary)
        }
      }

      if todos.isEmpty {
        Spacer(minLength: 0)
        HStack {
          Spacer()
          VStack(spacing: 4) {
            Image(systemName: "checkmark.circle")
              .font(.system(size: 22))
              .foregroundColor(.secondary)
            Text("다 끝냈어요")
              .font(.system(size: 11))
              .foregroundColor(.secondary)
          }
          Spacer()
        }
        Spacer(minLength: 0)
      } else {
        ForEach(todos) { todo in
          TodoRow(todo: todo, prominent: true)
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

/// 투두형 — the original kind.
///
/// 🔴 The kind string "SyncLinkWidget" must never change: WidgetKit keys placed
/// instances by it, so renaming would orphan every widget already on a home
/// screen. Same constraint as the Android AppWidgetProvider class name.
struct SyncLinkWidget: Widget {
  let kind = "SyncLinkWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      SyncLinkWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("할 일")
    .description("오늘 일정과 할 일. 체크박스를 눌러 바로 완료 처리.")
    .supportedFamilies([.systemSmall, .systemLarge])
  }
}

/// 달력형 — the month grid, now its own kind so it can be placed alongside
/// the todo widget rather than instead of it.
struct SyncLinkCalendarWidget: Widget {
  let kind = "SyncLinkCalendarWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      LargeView(snapshot: entry.snapshot)
        .padding(16)
    }
    .configurationDisplayName("달력")
    .description("이번 달 일정을 달력으로 한눈에.")
    // Large only — a 6×7 grid is unreadable at systemSmall, so we don't offer
    // the placement rather than degrading into something that isn't a calendar.
    .supportedFamilies([.systemLarge])
  }
}

/// 체크형 — todos only, sized for tapping.
struct SyncLinkCheckWidget: Widget {
  let kind = "SyncLinkCheckWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      CheckWidgetEntryView(entry: entry)
        .padding(16)
    }
    .configurationDisplayName("체크")
    .description("할 일만 크게. 홈 화면에서 바로 체크.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

/// Row count for 체크형 by family — padded rows are ~3× taller than 투두형's,
/// so cramming more would defeat the purpose.
private struct CheckWidgetEntryView: View {
  let entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    CheckView(snapshot: entry.snapshot, limit: family == .systemMedium ? 3 : 2)
  }
}

@main
struct SyncLinkWidgetBundle: WidgetBundle {
  var body: some Widget {
    SyncLinkWidget()
    SyncLinkCalendarWidget()
    SyncLinkCheckWidget()
  }
}
