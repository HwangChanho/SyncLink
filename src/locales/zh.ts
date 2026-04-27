const zh = {
  common: {
    ok: '确认',
    cancel: '取消',
    save: '保存',
    saving: '保存中…',
    delete: '删除',
    edit: '编辑',
    close: '关闭',
    back: '返回',
    next: '下一步',
    done: '完成',
    error: '错误',
    loading: '加载中…',
    retry: '重试',
    unknown: '未知',
    user: '用户',
    none: '无',
    preview: '预览',
    regenerate: '重新生成',
    export: '导出',
    confirm: '最终确认',
    warning: '警告',
    irreversible: '此操作无法撤销，是否继续？',
    save_failed: '保存失败。',
    delete_failed: '删除失败。',
    edit_failed: '编辑失败。',
    unknown_error: '发生了未知错误。',
    refresh: '刷新',
    system: '系统',
    group: '群组',
    add: '添加',
  },

  time: {
    today: '今天',
    tomorrow: '明天',
    yesterday: '昨天',
    just_now: '刚刚',
    all_day: '全天',
    am: '上午',
    pm: '下午',
    week_days: ['日', '一', '二', '三', '四', '五', '六'],
    annual: '每年',
    monthly: '每月',
    weekly: '每周',
    daily: '每天',
    no_repeat: '不重复',
    /** DateTimeModal 标题 — 当 allDay=false 时显示（同时显示日期和时间选择器）。 */
    datetime: '日期和时间',
    /** DateTimeModal 标题 — 当 allDay=true 时显示（仅日期选择器）。 */
    date: '日期',
    repeat_annual: ' · 每年重复',
    capacity_full: ' · 已满',
    /** Calendar view-mode tab labels (short form for the tab strip). */
    view_month: '月',
    view_week: '周',
    view_day: '日',
    /** Language names for the language-picker sheet. */
    lang_ko: '한국어',
    lang_en: 'English',
    lang_zh: '中文',
    lang_ja: '日本語',
  },

  greeting: {
    morning: '早上好',
    evening: '晚上好',
    hello: '你好',
  },

  tabs: {
    home: '首页',
    calendar: '日历',
    planner: '计划',
    my: '我的',
  },

  auth: {
    login: {
      tagline: '共享日程，AI 为您管理',
      google: '使用 Google 登录',
      kakao: '使用 Kakao 登录',
      apple: '使用 Apple 登录',
      dev_section: '开发者登录',
      dev_button: '邮箱登录',
      email_placeholder: '邮箱',
      password_placeholder: '密码',
      legal: '登录即表示您同意我们的服务条款和隐私政策。',
      error: '登录时发生错误。',
    },
    logout: {
      confirm: '确定要退出登录吗？',
      button: '退出登录',
      failed: '退出登录失败。',
    },
    callback: {
      parse_error: '无法解析回调 URL。',
      processing: '身份验证过程中发生错误。',
      not_found: '未找到凭证，请重新登录。',
    },
    delete_account: {
      button: '注销账户',
      confirm: '所有数据（日程、待办、Space）将被永久删除。\n确定要注销吗？',
      failed: '账户删除失败。',
    },
  },

  onboarding: {
    pages: [
      {
        title: '与任何人共享日程',
        subtitle: '情侣、团队、家人——创建 Space，轻松共享日程。',
      },
      {
        title: '用自然语言添加日程',
        subtitle: '输入"下周一下午3点团队会议"，日程立即创建。',
      },
      {
        title: 'AI 提醒',
        subtitle: '在重要日程前收到智能通知，AI 为您找到最佳提醒时机。',
      },
    ],
    skip: '跳过',
    start: '开始使用',
  },

  event: {
    title_placeholder: '请输入标题',
    untitled: '无标题',
    unknown: '未知日程',
    delete: '删除日程',
    delete_confirm: '此操作无法撤销，是否继续？',
    save_failed: '日程保存失败，请重试。',
    load_failed: '无法加载日程。',
    not_found: '找不到该日程。',
    save_error: '日程保存失败。',
    end_after_start: '结束时间必须晚于开始时间。',
    end_date_after_start: '结束日期必须晚于开始日期。',
    today_list_title: '今日日程',
    reminder: '日程提醒',
    reminder_desc: '在日程开始前30分钟收到通知。',
    // Sprint 26 R3 — Space 成员日程冲突警告
    conflict_warning_title: '日程冲突',
    conflict_warning_body: '与以下日程时间冲突：\n{{list}}\n仍要保存吗？',
    conflict_save_anyway: '继续保存',
  },

  todo: {
    today_list_title: '今日待办',
    delete: '删除待办',
    label: '待办',
    priority: {
      label: '优先级',
      high: '高',
      medium: '中',
      low: '低',
    },
    uncategorized: '未分类',
  },

  // Sprint 14 TASK-1413/1414 — 计划面板分类 UX
  planner: {
    change_category: '更换分类',
    new_category: '新建分类',
    category_none: '无分类',
    category_changed: '分类已更新',
  },

  // Sprint 14 TASK-1407 — 广告与奖励
  ads: {
    watch_to_unlock: '观看广告再用 2 次 AI',
    watch_failed: '广告播放失败',
    reward_earned: '已获得 {{count}} 次 AI 积分！',
    daily_limit_reached: '今天的广告次数已达上限',
    not_available: '暂时无法播放广告',
  },
  rewards: {
    credit_balance: 'AI 积分：{{count}} 次',
    credit_consumed: '已使用 1 次 AI 积分',
  },
  ai: {
    quota_exceeded_title: 'AI 额度已用尽',
    quota_exceeded_subtitle: '你今天的免费 AI 额度已使用完毕。',
    upgrade_cta: '升级到 Pro',
  },

  note: {
    label: '笔记',
    delete: '删除笔记',
    delete_confirm: '此操作无法撤销，是否继续？',
    edit: '编辑笔记',
    title_placeholder: '请输入笔记标题',
    save_failed: '笔记保存失败。',
  },

  space: {
    types: {
      couple: '情侣',
      couple_desc: '仅限两人（最多2名成员）',
      group: '群组',
      group_desc: '家人、朋友或团队',
    },
    name_placeholder: '请输入 Space 名称',
    create_failed: 'Space 创建失败。',
    join_failed: '加入 Space 失败。',
    join_error: '参与 Space 失败。',
    leave: '退出 Space',
    leave_confirm: '确定要退出此 Space 吗？',
    leave_failed: '退出失败。',
    leave_owner: '退出后，所有权将转让给下一位成员。确定退出吗？',
    leave_button: '退出',
    kick: '移除成员',
    kick_failed: '移除成员失败。',
    load_failed: '无法加载 Space。',
    not_found: '找不到该 Space。',
    invalid_code: '无效的邀请码。',
    no_code: '暂无邀请码。',
    code_error: '代码错误',
    regen_confirm: '现有代码将失效，生成新代码吗？',
    regen: '重新生成',
    regen_failed: '重新生成失败。',
    invite_regen: '重新生成邀请码',
    join_fail_title: '加入失败',
    join_fail_desc: '加入失败',
    need_name: '需要名称',
    activity_notification: 'Space 动态通知',
    // IDEA-014 — Web 邀请 UX 增强
    invite_email: '通过邮件邀请',
    invite_qr: '显示二维码',
    invite_link_copy: '复制邀请链接',
    invite_link_copied: '邀请链接已复制！',
    invite_link_copy_failed: '复制失败，请手动选择链接。',
    activity_notification_desc: '当 Space 成员添加或修改共享日程时收到通知。',
    // IDEA-016: invite code lifecycle error messages
    invite_expired: '邀请码已过期，请向 Space 管理员申请新的邀请码。',
    invite_max_uses_reached: '邀请码已达到使用上限，请向 Space 管理员申请新的邀请码。',
    couple_full: '情侣 Space 最多只能有 2 名成员。',
  },

  category: {
    new: '新建分类',
    delete: '删除分类',
    edit: '编辑分类',
    name_placeholder: '请输入分类名称',
    load_failed: '无法加载分类。',
    builtin: {
      personal: '个人',
      work:     '工作',
      other:    '其他',
    },
  },

  notification: {
    permission_required: '需要权限',
    permission_desc: '需要通知权限才能接收提醒。',
    event_reminder: '日程提醒',
    event_reminder_desc: '在日程开始前30分钟收到通知。',
    space_activity: 'Space 动态',
    space_activity_desc: '当 Space 成员添加或修改共享日程时收到通知。',
    event_share: '共享日程通知',
    event_share_desc: '当新日程共享到您的 Space 时收到通知。',
    save_failed: '设置保存失败。',
  },

  profile: {
    nickname_placeholder: '请输入昵称',
    nickname_too_long: '昵称不能超过20个字符。',
    nickname_required: '请输入昵称。',
    nickname_failed: '昵称保存失败。',
    onboarding_title: '我们该怎么称呼您？',
    onboarding_subtitle: '设置共享日程时使用的昵称。\n您可以随时在"我的"标签中修改。',
    onboarding_skip: '稍后设置',
    avatar_permission: '更改头像需要照片访问权限，请在设置中允许。',
    avatar_failed: '头像上传失败。',
    theme: {
      label: '主题',
      light: '浅色',
      dark: '深色',
      system: '系统',
    },
  },

  anniversary: {
    title_placeholder: '请输入纪念日标题',
    delete: '删除纪念日',
    add_failed: '添加纪念日失败。',
    date_invalid: '日期格式不正确，请使用 YYYY-MM-DD 格式。',
    date_not_exist: '该日期不存在，请重新确认。',
    date_example: '请输入有效日期。（例：年 2024，月 03，日 15）',
    input_error: '输入错误',
  },

  comment: {
    delete: '删除评论',
    delete_confirm: '确定要删除此评论吗？',
    delete_failed: '评论删除失败。',
    write_failed: '评论发布失败。',
  },

  reaction: {
    change_failed: '反应更新失败。',
  },

  share: {
    update_failed: '共享设置更新失败。',
    event_share_notification: '共享日程通知',
    event_share_desc: '当新日程共享到您的 Space 时收到通知。',
  },

  nl: {
    placeholder: '用自然语言添加日程…',
    ai_limit: 'AI 使用次数已达上限。',
    save_failed: '日程保存失败，请重试。',
    error: '发生错误。',
  },

  review: {
    loading: '正在加载周报…',
    load_failed: '无法加载周报。',
    empty: '下拉刷新以生成周报。',
    regenerate: '重新生成',
    regen_failed: '重新生成失败。',
  },

  settings: {
    app_lock: '应用锁',
    app_lock_desc: '使用 Face ID 或 Touch ID 锁定应用。从后台返回时需要验证。',
    authenticate: '验证',
    language: '语言',
    language_help: '选择后整个应用的文本会立即切换。',
  },

  places: {
    search_placeholder: '搜索地点…',
    no_results: '无结果。',
  },

  weather: {
    loading: '正在加载天气…',
    unavailable: '无法获取天气信息。',
    air_pm25: 'PM2.5',
    grade_good: '良好',
    grade_fair: '一般',
    grade_moderate: '一般',
    grade_poor: '较差',
    grade_very_poor: '非常差',
  },

  calendar: {
    title: {
      month: '{{year}}年{{month}}月{{day}}日',
      week:  '{{year}}年 {{startMonth}}月{{startDay}}日 ~ {{endMonth}}月{{endDay}}日',
      day:   '{{year}}年{{month}}月{{day}}日 ({{dow}})',
    },
    weekday: {
      sun: '日', mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六',
    },
    // PRD 4.2 Tier 2 — Free time finder UI strings
    free_time_show:      '查看空闲时间',
    free_time_hide:      '隐藏空闲时间',
    free_time_no_space:  '加入 Space 以查看空闲时间。',
    free_time_select:    '选择 Space',
    free_time_empty:     '所选时间段内无共同空闲时间。',
    free_time_month_hint:'空闲时间将在周/日视图中显示。',
  },

  date_suggest: {
    title: '日期推荐',
    loading: '正在生成推荐…',
    empty: '暂无推荐。',
    create_event: '创建日程',
  },

  reminder: {
    title: '提醒',
    add: '添加提醒',
    none: '无',
    minutes_before: '提前 {{count}} 分钟',
    hours_before: '提前 {{count}} 小时',
    days_before: '提前 {{count}} 天',
    custom: '自定义',
    unit_minutes: '分钟',
    unit_hours: '小时',
    kakao_web_notice: 'Kakao 登录仅在应用中可用',
  },

  // Sprint 15 TASK-1504 — shared-event AI translation strings
  translation: {
    badge_translated: '已翻译',
    show_original: '查看原文',
    show_translated: '查看译文',
    pro_only: 'Pro 专属功能。',
  },

  // Sprint 15 TASK-1510 — PIN lock strings
  pin_lock: {
    title: '密码锁',
    enable: '启用 PIN',
    disable: '关闭 PIN',
    set_title: '设置密码',
    enter: '请输入 4 位数字密码',
    confirm: '请再次输入以确认',
    enter_current: '请输入当前密码',
    mismatch: '密码不一致。',
    incorrect: '密码错误。',
    success: '密码已设置。',
    disabled: '密码已关闭。',
    change: '更改密码',
    forgot: '忘记密码?',
    use_pin: '使用密码',
    use_biometric: '使用生物识别',
    description: '打开应用时需要输入 4 位数字密码,可在生物识别不可用或失败时作为备用方案。',
  },

  // Sprint 15 TASK-1520 — offline banner
  offline: {
    banner: '当前处于离线状态',
    retry: '重试',
  },

  paywall: {
    title: 'SyncLink Pro',
    headline: '无限制使用所有功能',
    features: [
      'AI 自然语言日程无限制',
      '每周周报',
      'Space 无限制',
      'AI 日期推荐',
      '无广告',
    ],
    loading: '正在加载价格…',
    monthly_label: '月付',
    annual_label: '年付',
    monthly_price: '¥19',
    annual_price: '¥148',
    monthly_period: '/月',
    annual_period: '/年',
    annual_savings: '月均 ¥12.3 — 节省 36%',
    popular: '热门',
    cta: '立即开始',
    restore: '恢复购买',
    dismiss: '免费继续使用',
    legal: '通过 App Store / Google Play 处理付款，随时可取消订阅。',
    purchase_unavailable_title: '无法购买',
    purchase_unavailable_desc: '当前无法处理付款，请稍后重试。',
    purchase_complete_title: '订阅成功',
    purchase_complete_desc: '开始使用 SyncLink Pro！',
    purchase_failed_title: '购买失败',
    purchase_failed_desc: '付款过程中发生错误。',
    restore_complete_title: '恢复成功',
    restore_complete_desc: '您的订阅已恢复。',
    restore_none_title: '未找到订阅',
    restore_none_desc: '未找到历史购买记录。',
    restore_failed_title: '恢复失败',
    restore_failed_desc: '恢复过程中发生错误。',
  },
} as const;

export default zh;
