// src/lib/appConfig.ts

// ========================================
// 中央設定檔
// 之後所有容易調整的名稱、連結、規則，都集中放在這裡
// 其他檔案不要再自己寫死，統一從這裡讀
// ========================================

// ===== Google Sheets 基本設定 =====
export const GOOGLE_SHEETS_CONFIG = {
  // 主試算表 ID
  SPREADSHEET_ID: '1aB3RGJy7nSVqpifb81zC3ZNc8FiTYlSj-Wzf_as2C24',

  // 已發布的 reading_history CSV 連結
  READING_HISTORY_PUBLISHED_CSV:
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-ls92upvKzSnUVd5JGyo1vVCDXbq4O65Z2LrsP0Yc6FhO_KrD3vnpJy9N0k9IMgvJkONVjFIuwP-O/pub?gid=1021940697&single=true&output=csv',
} as const;

// ===== 工作表名稱 =====
export const SHEET_NAMES = {
  READING_ARTICLES: 'reading_articles',
  READING_HISTORY: 'reading_history',
  READING_WEEKLY_GOALS: 'reading_weekly_goals',
  STUDENTS: 'students',
  STUDENT_PROGRESS: 'student_progress',
  READING_ASSIGNMENTS: 'reading_assignments',
  EXERCISE_QUESTIONS: 'exercise_questions',
  EXERCISE_ASSIGNMENTS: 'exercise_assignments',
} as const;

// ===== 欄位名稱：reading_articles =====
export const READING_ARTICLES_FIELDS = {
  ID: 'id',
  ARTICLE_CODE: 'article_code',
  TITLE: 'title',
  WORD_RANGE: 'word_range',
  DURATION_SEC: 'duration_sec',
  ARTICLE_TEXT: 'article_text',
  FULL_MEANING_ZH: 'full_meaning_zh',
  SUPPORT_WORDS: 'support_words',
  IS_PUBLISHED: 'is_published',
  NOTES: 'notes',
} as const;

// ===== 欄位名稱：exercise_questions =====
export const EXERCISE_QUESTIONS_FIELDS = {
  ID: 'id',
  EXERCISE_CODE: 'exercise_code',
  QUESTION_TEXT: 'question_text',
  OPTION_A: 'option_a',
  OPTION_B: 'option_b',
  OPTION_C: 'option_c',
  OPTION_D: 'option_d',
  CORRECT_ANSWER: 'correct_answer',
  WORD_RANGE: 'word_range',
  DIFFICULTY: 'difficulty',
  TAGS: 'tags',
} as const;

// ===== 欄位名稱：exercise_assignments =====
export const EXERCISE_ASSIGNMENTS_FIELDS = {
  ASSIGNMENT_ID: 'assignment_id',
  STUDENT_ID: 'student_id',
  EXERCISE_CODE: 'exercise_code',
  ASSIGNED_AT: 'assigned_at',
  DUE_DATE: 'due_date',
  STATUS: 'status',
} as const;

// ===== 欄位名稱：reading_history =====
export const READING_HISTORY_FIELDS = {
  HISTORY_ID: 'history_id',
  STUDENT_ID: 'student_id',
  ARTICLE_ID: 'article_id',
  ARTICLE_CODE: 'article_code',
  TITLE: 'title',
  STATUS: 'status',
  COMPLETED_AT: 'completed_at',
  DURATION_SEC: 'duration_sec',
  NOTES: 'notes',
} as const;

// ===== 欄位名稱：students =====
export const STUDENTS_FIELDS = {
  studentId: 'student_id',
  studentName: 'student_name',
  loginCode: 'login_code',
  status: 'status',
  studentUrl: 'student_url',
  notes: 'notes',
} as const;

// ===== 閱讀狀態 =====
export const READING_STATUS = {
  COMPLETED: 'completed',
  NOT_DONE: 'not_done',
} as const;

// ===== 學生 ID 規則說明 =====
export const STUDENT_CONFIG = {
  // 系統目前實際使用的學生 id 範例
  // 注意：Google Sheets 裡的 student_id 要和 db.getCurrentUserId() 對得上
  CURRENT_STUDENT_ID_EXAMPLE: 'u1',
} as const;

// ===== UI 顯示文字 =====
export const UI_LABELS = {
  REPORT_TITLE: 'Performance Report',
  READING_HISTORY_TITLE: 'Reading History',
  WEEKLY_READING_GOAL_TITLE: 'Weekly Reading Goal',
  FLASHCARD_HISTORY_TITLE: 'Flashcard History',
} as const;

// ===== Debug 開關 =====
export const DEBUG_CONFIG = {
  ENABLE_REPORT_CARD_LOG: true,
} as const;

export const GOOGLE_APPS_SCRIPT_CONFIG = {
  READING_HISTORY_WEB_APP_URL:
    'https://script.google.com/macros/s/AKfycbyBvCSVtiaql_VD-OCIDUriKeFcwIK1Znp-nm1YdQfxWXdh8m7oZY-vUoPMWQRProdguQ/exec',
} as const;