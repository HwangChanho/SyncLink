/**
 * Korean translations — default locale.
 * Edit strings here to update Korean UI text.
 */
const ko = {
  common: {
    ok: '확인',
    cancel: '취소',
    save: '저장',
    saving: '저장 중…',
    delete: '삭제',
    edit: '편집',
    close: '닫기',
    back: '뒤로',
    next: '다음',
    done: '완료',
    error: '오류',
    loading: '불러오는 중…',
    retry: '다시 시도',
    unknown: '알 수 없음',
    user: '사용자',
    none: '없음',
    preview: '미리보기',
    regenerate: '재생성',
    export: '내보내기',
    confirm: '최종 확인',
    warning: '주의',
    irreversible: '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
    save_failed: '저장에 실패했습니다.',
    delete_failed: '삭제에 실패했습니다.',
    edit_failed: '수정에 실패했습니다.',
    unknown_error: '알 수 없는 오류가 발생했습니다.',
    refresh: '새로 고침',
    system: '시스템',
    group: '그룹',
    add: '추가',
  },

  time: {
    today: '오늘',
    tomorrow: '내일',
    yesterday: '어제',
    just_now: '방금',
    all_day: '종일',
    am: '오전',
    pm: '오후',
    week_days: ['일', '월', '화', '수', '목', '금', '토'],
    annual: '매년',
    monthly: '매월',
    weekly: '매주',
    daily: '매일',
    no_repeat: '반복 없음',
    /** DateTimeModal header label — shown when allDay=false (both date & time pickers visible). */
    datetime: '날짜 및 시간',
    /** DateTimeModal header label — shown when allDay=true (date-only picker). */
    date: '날짜',
    repeat_annual: ' · 매년 반복',
    capacity_full: ' · 정원 마감',
    /** Calendar view-mode tab labels (short form for the tab strip). */
    view_month: '월',
    view_week: '주',
    view_day: '일',
    /** Language names for the language-picker sheet. */
    lang_ko: '한국어',
    lang_en: 'English',
    lang_zh: '中文',
    lang_ja: '日本語',
  },

  greeting: {
    morning: '좋은 아침이에요',
    evening: '좋은 저녁이에요',
    hello: '안녕하세요',
  },

  tabs: {
    home: '홈',
    calendar: '캘린더',
    planner: '플래너',
    my: '내 정보',
  },

  auth: {
    login: {
      tagline: '함께하는 일정, AI가 챙겨드려요',
      google: 'Google로 시작하기',
      kakao: '카카오로 시작하기',
      apple: 'Apple로 시작하기',
      dev_section: '개발자 로그인',
      dev_button: '이메일로 로그인',
      email_placeholder: '이메일',
      password_placeholder: '비밀번호',
      legal: '로그인하면 서비스 이용약관 및 개인정보처리방침에 동의하게 됩니다.',
      error: '로그인 중 오류가 발생했습니다.',
    },
    logout: {
      confirm: '로그아웃 하시겠습니까?',
      button: '로그아웃',
      failed: '로그아웃에 실패했습니다.',
    },
    callback: {
      parse_error: '콜백 URL을 파싱하지 못했습니다.',
      processing: '인증 처리 중 오류가 발생했습니다.',
      not_found: '인증 정보를 찾지 못했습니다. 다시 로그인해 주세요.',
    },
    delete_account: {
      button: '회원 탈퇴',
      confirm: '탈퇴 시 모든 데이터(일정, 할일, Space)가 영구적으로 삭제됩니다.\n정말 탈퇴하시겠습니까?',
      failed: '계정 삭제에 실패했습니다.',
    },
  },

  onboarding: {
    pages: [
      {
        title: '함께 일정을 공유하세요',
        subtitle: '커플, 팀, 가족 — 누구와도 Space를 만들어 일정을 손쉽게 공유하세요.',
      },
      {
        title: '자연어로 일정 등록',
        subtitle: '"다음 주 월요일 오후 3시 팀 미팅"을 입력하면 즉시 일정이 만들어집니다.',
      },
      {
        title: 'AI 리마인더',
        subtitle: '중요한 일정 전에 스마트 알림을 받으세요. AI가 최적의 타이밍을 찾아드립니다.',
      },
    ],
    skip: '건너뛰기',
    start: '시작하기',
  },

  event: {
    title_placeholder: '제목을 입력해 주세요.',
    untitled: '제목 없음',
    unknown: '알 수 없는 일정',
    delete: '일정 삭제',
    delete_confirm: '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
    save_failed: '일정 저장에 실패했어요. 다시 시도해주세요.',
    load_failed: '일정을 불러오지 못했습니다.',
    not_found: '일정을 찾을 수 없습니다.',
    save_error: '일정을 저장하지 못했습니다.',
    end_after_start: '종료 시간이 시작 시간보다 늦어야 합니다.',
    end_date_after_start: '종료일이 시작일보다 늦어야 합니다.',
    today_list_title: '오늘 일정',
    reminder: '일정 리마인더',
    reminder_desc: '일정 30분 전에 알림을 받습니다.',
  },

  todo: {
    today_list_title: '오늘 할일',
    delete: '할일 삭제',
    label: '할일',
    priority: {
      label: '우선순위',
      high: '높음',
      medium: '보통',
      low: '낮음',
    },
    uncategorized: '미분류',
  },

  // Sprint 14 TASK-1413/1414 — 플래너 카테고리 UX 문자열
  planner: {
    change_category: '카테고리 변경',
    new_category: '새 카테고리',
    category_none: '카테고리 없음',
    category_changed: '카테고리가 변경되었습니다',
  },

  // Sprint 14 TASK-1407 — 광고/보상 관련 문구
  ads: {
    watch_to_unlock: '광고 보고 AI 2회 더 사용',
    watch_failed: '광고 재생에 실패했습니다',
    reward_earned: 'AI 크레딧 {{count}}회 획득!',
    daily_limit_reached: '오늘 광고 시청 한도에 도달했습니다',
    not_available: '지금은 광고를 재생할 수 없습니다',
  },
  rewards: {
    credit_balance: 'AI 크레딧: {{count}}회',
    credit_consumed: 'AI 크레딧 1회 사용',
  },
  ai: {
    quota_exceeded_title: 'AI 쿼터 초과',
    quota_exceeded_subtitle: '오늘의 무료 AI 사용량을 모두 사용했어요.',
    upgrade_cta: 'Pro로 업그레이드',
  },

  note: {
    label: '노트',
    delete: '노트 삭제',
    delete_confirm: '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
    edit: '노트 편집',
    title_placeholder: '노트 제목을 입력해 주세요.',
    save_failed: '노트 저장에 실패했습니다.',
  },

  space: {
    types: {
      couple: '커플',
      couple_desc: '연인과 단둘이 (최대 2명)',
      group: '그룹',
      group_desc: '가족, 친구, 팀과 함께',
    },
    name_placeholder: 'Space 이름을 입력해 주세요.',
    create_failed: 'Space 생성에 실패했습니다.',
    join_failed: 'Space 가입에 실패했습니다.',
    join_error: 'Space 참여에 실패했습니다.',
    leave: 'Space 탈퇴',
    leave_confirm: '이 Space에서 탈퇴할까요?',
    leave_failed: '탈퇴에 실패했습니다.',
    leave_owner: '탈퇴 시 소유권이 다음 멤버에게 이전됩니다. 탈퇴할까요?',
    leave_button: '탈퇴하기',
    kick: '멤버 추방',
    kick_failed: '멤버 추방에 실패했습니다.',
    load_failed: 'Space를 불러오지 못했습니다.',
    not_found: 'Space를 찾을 수 없습니다.',
    invalid_code: '유효하지 않은 초대 코드입니다.',
    no_code: '초대 코드가 없습니다.',
    code_error: '코드 오류',
    regen_confirm: '기존 코드가 무효화됩니다. 새로 생성할까요?',
    regen: '재생성',
    regen_failed: '재생성에 실패했습니다.',
    invite_regen: '초대 코드 재생성',
    join_fail_title: '참여 실패',
    join_fail_desc: '가입 실패',
    need_name: '이름 필요',
    activity_notification: 'Space 활동 알림',
    activity_notification_desc: 'Space 멤버가 공유 일정을 추가하거나 수정할 때 알림을 받습니다.',
  },

  category: {
    new: '새 카테고리',
    delete: '카테고리 삭제',
    edit: '카테고리 수정',
    name_placeholder: '카테고리 이름을 입력해 주세요.',
    load_failed: '카테고리를 불러오지 못했습니다.',
  },

  notification: {
    permission_required: '권한 필요',
    permission_desc: '알림을 받으려면 권한이 필요합니다.',
    event_reminder: '일정 리마인더',
    event_reminder_desc: '일정 30분 전에 알림을 받습니다.',
    space_activity: 'Space 활동 알림',
    space_activity_desc: 'Space 멤버가 공유 일정을 추가하거나 수정할 때 알림을 받습니다.',
    event_share: '공유 일정 알림',
    event_share_desc: '내 Space에 새 일정이 공유될 때 알림을 받습니다.',
    save_failed: '설정 저장에 실패했습니다.',
  },

  profile: {
    nickname_placeholder: '닉네임 입력',
    nickname_too_long: '닉네임은 20자 이하로 입력해 주세요.',
    nickname_required: '닉네임을 입력해 주세요.',
    nickname_failed: '닉네임 저장에 실패했습니다.',
    onboarding_title: '어떻게 불러드릴까요?',
    onboarding_subtitle: '함께 일정을 공유할 때 사용할 닉네임을 설정해 주세요.\n나중에 My 탭에서 언제든 변경할 수 있습니다.',
    onboarding_skip: '나중에 설정하기',
    avatar_permission: '아바타를 변경하려면 사진 접근 권한이 필요합니다. 설정에서 허용해 주세요.',
    avatar_failed: '아바타 업로드에 실패했습니다.',
    theme: {
      label: '테마',
      light: '라이트',
      dark: '다크',
      system: '시스템',
    },
  },

  anniversary: {
    title_placeholder: '기념일 제목을 입력해 주세요.',
    delete: '기념일 삭제',
    add_failed: '기념일 추가에 실패했습니다.',
    date_invalid: '날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요.',
    date_not_exist: '존재하지 않는 날짜입니다. 다시 확인해 주세요.',
    date_example: '올바른 날짜를 입력해 주세요. (예: 연도 2024, 월 03, 일 15)',
    input_error: '입력 오류',
  },

  comment: {
    delete: '코멘트 삭제',
    delete_confirm: '이 코멘트를 삭제하시겠습니까?',
    delete_failed: '코멘트 삭제에 실패했습니다.',
    write_failed: '코멘트 작성에 실패했습니다.',
  },

  reaction: {
    change_failed: '반응 변경에 실패했습니다.',
  },

  share: {
    update_failed: '공유 설정 변경에 실패했습니다.',
    event_share_notification: '공유 일정 알림',
    event_share_desc: '내 Space에 새 일정이 공유될 때 알림을 받습니다.',
  },

  nl: {
    placeholder: '일정을 자연어로 입력하세요…',
    ai_limit: 'AI 사용 한도에 도달했습니다.',
    save_failed: '일정 저장에 실패했어요. 다시 시도해주세요.',
    error: '검색 중 오류가 발생했습니다.',
    voice_start: '음성으로 입력',
    voice_stop: '음성 입력 중지',
    voice_error: '음성 인식에 실패했습니다.',
    voice_permission: '마이크 권한이 필요합니다.',
  },

  review: {
    loading: '리뷰를 불러오는 중...',
    load_failed: '리뷰를 불러오지 못했습니다.',
    empty: '이번 주 리뷰가 없습니다.',
    regenerate: '재생성',
    regen_failed: '재생성에 실패했습니다.',
  },

  settings: {
    app_lock: '앱 잠금',
    app_lock_desc: 'Face ID 또는 Touch ID로 앱을 잠급니다. 백그라운드에서 돌아올 때 인증이 필요합니다.',
    authenticate: '인증하기',
  },

  places: {
    search_placeholder: '장소를 검색하세요…',
    no_results: '결과가 없습니다.',
  },

  weather: {
    loading: '날씨 정보를 불러오는 중…',
    unavailable: '날씨 정보를 불러올 수 없습니다.',
    air_pm25: '미세먼지',
    grade_good: '좋음',
    grade_fair: '보통',
    grade_moderate: '보통',
    grade_poor: '나쁨',
    grade_very_poor: '매우 나쁨',
  },

  date_suggest: {
    title: '날짜 추천',
    loading: '추천을 생성하는 중…',
    empty: '추천할 일정이 없습니다.',
    create_event: '일정 만들기',
  },

  reminder: {
    title: '리마인더',
    add: '리마인더 추가',
    none: '없음',
    minutes_before: '{{count}}분 전',
    hours_before: '{{count}}시간 전',
    days_before: '{{count}}일 전',
    custom: '직접 입력',
    unit_minutes: '분',
    unit_hours: '시간',
    kakao_web_notice: '카카오 로그인은 앱에서 이용 가능합니다',
  },

  // Sprint 15 TASK-1504 — 공유 이벤트 AI 번역 관련 문자열
  translation: {
    badge_translated: '번역됨',
    show_original: '원문 보기',
    show_translated: '번역 보기',
    pro_only: 'Pro 전용 기능입니다.',
  },

  // Sprint 15 TASK-1510 — PIN 잠금 관련 문자열
  pin_lock: {
    title: '비밀번호 잠금',
    enable: 'PIN 사용',
    disable: 'PIN 해제',
    set_title: 'PIN 설정',
    enter: '비밀번호를 입력하세요',
    confirm: '비밀번호를 한 번 더 입력하세요',
    enter_current: '현재 비밀번호를 입력하세요',
    mismatch: '비밀번호가 일치하지 않습니다.',
    incorrect: '비밀번호가 올바르지 않습니다.',
    success: 'PIN이 설정되었습니다.',
    disabled: 'PIN이 해제되었습니다.',
    change: 'PIN 변경',
    forgot: '비밀번호를 잊으셨나요?',
    use_pin: '비밀번호 입력',
    use_biometric: '생체 인증 사용',
    description: '앱을 열 때 4자리 숫자 비밀번호를 요구합니다. 생체 인증 미지원 기기나 생체 인증 실패 시 사용할 수 있습니다.',
  },

  // Sprint 15 TASK-1520 — 네트워크 오프라인 배너
  offline: {
    banner: '오프라인 상태입니다',
    retry: '재시도',
  },

  paywall: {
    title: 'SyncLink Pro',
    headline: '모든 기능을 제한 없이 사용하세요',
    features: [
      'AI 자연어 일정 무제한',
      '주간 리뷰 매주',
      'Space 무제한',
      '날짜 추천 AI',
      '광고 없음',
    ],
    loading: '가격 정보를 불러오는 중...',
    monthly_label: '월간',
    annual_label: '연간',
    monthly_price: '3,900원',
    annual_price: '29,900원',
    monthly_period: '/월',
    annual_period: '/년',
    annual_savings: '월 2,492원 — 36% 절약',
    popular: '인기',
    cta: '지금 시작하기',
    restore: '구매 복원',
    dismiss: '무료로 계속 사용',
    legal: '결제는 App Store / Google Play를 통해 처리됩니다. 구독은 언제든지 해지할 수 있습니다.',
    purchase_unavailable_title: '결제 불가',
    purchase_unavailable_desc: '현재 결제를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    purchase_complete_title: '구독 완료',
    purchase_complete_desc: 'SyncLink Pro를 시작하세요.',
    purchase_failed_title: '결제 실패',
    purchase_failed_desc: '결제 중 오류가 발생했습니다.',
    restore_complete_title: '복원 완료',
    restore_complete_desc: '구독이 복원되었습니다.',
    restore_none_title: '복원할 구독 없음',
    restore_none_desc: '구독 내역을 찾지 못했습니다.',
    restore_failed_title: '복원 실패',
    restore_failed_desc: '복원 중 오류가 발생했습니다.',
  },
} as const;

export type TranslationKeys = typeof ko;
export default ko;
