import {
  GOOGLE_SHEETS_CONFIG,
  GOOGLE_APPS_SCRIPT_CONFIG,
  SHEET_NAMES,
  READING_ARTICLES_FIELDS,
  READING_HISTORY_FIELDS,
  READING_STATUS,
} from './appConfig';

export type SheetReadingArticle = {
  id: string;
  articleCode: string;
  title: string;
  wordRange: string;
  durationSec: number;
  articleText: string;
  fullMeaningZh: string;
  supportWords: string[];
  isPublished: boolean;
  notes: string;
};

export type SheetReadingHistoryRow = {
  historyId: string;
  studentId: string;
  articleId: string;
  articleCode: string;
  title: string;
  status: 'completed' | 'not_done';
  completedAt: string;
  durationSec: number;
  notes: string;
};

export type SheetReadingWeeklyGoalRow = {
  goalId: string;
  studentId: string;
  weekRange: string;
  assignedRange: string;
  dailyTarget: number;
  remainingToday: number;
};

export type SheetReadingAssignmentRow = {
  assignmentId: string;
  studentId: string;
  articleId: string;
  articleCode: string;
  status: string;
  assignedDate: string;
  dueDate: string;
};

const SPREADSHEET_ID = GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID;

const READING_ARTICLES_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAMES.READING_ARTICLES}`;

const READING_HISTORY_CSV_URL =
  GOOGLE_SHEETS_CONFIG.READING_HISTORY_PUBLISHED_CSV;

const READING_WEEKLY_GOALS_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAMES.READING_WEEKLY_GOALS}`;

const READING_ASSIGNMENTS_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAMES.READING_ASSIGNMENTS}`;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map((cell) => cell.trim());
}

function parseCsv(csvText: string): string[][] {
  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  return lines.map(parseCsvLine);
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseSupportWords(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);
}

function parseBoolean(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

export async function fetchAllReadingArticles(): Promise<SheetReadingArticle[]> {
  const response = await fetch(READING_ARTICLES_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch reading articles: ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const idIndex = getIndex(READING_ARTICLES_FIELDS.ID);
  const articleCodeIndex = getIndex(READING_ARTICLES_FIELDS.ARTICLE_CODE);
  const titleIndex = getIndex(READING_ARTICLES_FIELDS.TITLE);
  const wordRangeIndex = getIndex(READING_ARTICLES_FIELDS.WORD_RANGE);
  const durationSecIndex = getIndex(READING_ARTICLES_FIELDS.DURATION_SEC);
  const articleTextIndex = getIndex(READING_ARTICLES_FIELDS.ARTICLE_TEXT);
  const fullMeaningZhIndex = getIndex(READING_ARTICLES_FIELDS.FULL_MEANING_ZH);
  const supportWordsIndex = getIndex(READING_ARTICLES_FIELDS.SUPPORT_WORDS);
  const isPublishedIndex = getIndex(READING_ARTICLES_FIELDS.IS_PUBLISHED);
  const notesIndex = getIndex(READING_ARTICLES_FIELDS.NOTES);

  return rows
    .slice(1)
    .filter((row) => row[idIndex]?.trim())
    .map((row) => ({
      id: row[idIndex] || '',
      articleCode: articleCodeIndex >= 0 ? row[articleCodeIndex] || '' : '',
      title: row[titleIndex] || '',
      wordRange: row[wordRangeIndex] || '',
      durationSec: Number(row[durationSecIndex] || 0),
      articleText: row[articleTextIndex] || '',
      fullMeaningZh: row[fullMeaningZhIndex] || '',
      supportWords: parseSupportWords(row[supportWordsIndex] || ''),
      isPublished: isPublishedIndex >= 0 ? parseBoolean(row[isPublishedIndex] || '') : true,
      notes: notesIndex >= 0 ? row[notesIndex] || '' : '',
    }));
}

export async function fetchReadingArticleById(
  id: string
): Promise<SheetReadingArticle | null> {
  const articles = await fetchAllReadingArticles();
  return articles.find((article) => article.id === id && article.isPublished) || null;
}

export async function fetchReadingHistoryByStudentId(
  studentId: string
): Promise<SheetReadingHistoryRow[]> {
  const response = await fetch(READING_HISTORY_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch reading history: ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const historyIdIndex = getIndex(READING_HISTORY_FIELDS.HISTORY_ID);
  const studentIdIndex = getIndex(READING_HISTORY_FIELDS.STUDENT_ID);
  const articleIdIndex = getIndex(READING_HISTORY_FIELDS.ARTICLE_ID);
  const articleCodeIndex = getIndex(READING_HISTORY_FIELDS.ARTICLE_CODE);
  const titleIndex = getIndex(READING_HISTORY_FIELDS.TITLE);
  const statusIndex = getIndex(READING_HISTORY_FIELDS.STATUS);
  const completedAtIndex = getIndex(READING_HISTORY_FIELDS.COMPLETED_AT);
  const durationSecIndex = getIndex(READING_HISTORY_FIELDS.DURATION_SEC);
  const notesIndex = getIndex(READING_HISTORY_FIELDS.NOTES);

  console.log('📊 reading_history headers:', headers);
  console.log('📊 reading_history studentId filter:', studentId);

  return rows
    .slice(1)
    .filter((row) => row[studentIdIndex]?.trim() === studentId)
    .map((row) => ({
      historyId: historyIdIndex >= 0 ? row[historyIdIndex] || '' : '',
      studentId: row[studentIdIndex] || '',
      articleId: articleIdIndex >= 0 ? row[articleIdIndex] || '' : '',
      articleCode: articleCodeIndex >= 0 ? row[articleCodeIndex] || '' : '',
      title: titleIndex >= 0 ? row[titleIndex] || '' : '',
      status:
        row[statusIndex] === READING_STATUS.COMPLETED
          ? READING_STATUS.COMPLETED
          : READING_STATUS.NOT_DONE,
      completedAt: completedAtIndex >= 0 ? row[completedAtIndex] || '' : '',
      durationSec: durationSecIndex >= 0 ? Number(row[durationSecIndex] || 0) : 0,
      notes: notesIndex >= 0 ? row[notesIndex] || '' : '',
    }));
}

export async function fetchReadingWeeklyGoalByStudentId(
  studentId: string
): Promise<SheetReadingWeeklyGoalRow | null> {
  const response = await fetch(READING_WEEKLY_GOALS_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch reading weekly goals: ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const goalIdIndex = getIndex('goal_id');
  const studentIdIndex = getIndex('student_id');
  const weekRangeIndex = getIndex('week_range');
  const assignedRangeIndex = getIndex('assigned_range');
  const dailyTargetIndex = getIndex('daily_target');
  const remainingTodayIndex = getIndex('remaining_today');

  console.log('📊 reading_weekly_goals headers:', headers);
  console.log('📊 reading_weekly_goals studentId filter:', studentId);

  const matchedRow = rows
    .slice(1)
    .find((row) => row[studentIdIndex]?.trim() === studentId);

  if (!matchedRow) {
    return null;
  }

  return {
    goalId: goalIdIndex >= 0 ? matchedRow[goalIdIndex] || '' : '',
    studentId: matchedRow[studentIdIndex] || '',
    weekRange: weekRangeIndex >= 0 ? matchedRow[weekRangeIndex] || '' : '',
    assignedRange: assignedRangeIndex >= 0 ? matchedRow[assignedRangeIndex] || '' : '',
    dailyTarget: dailyTargetIndex >= 0 ? Number(matchedRow[dailyTargetIndex] || 0) : 0,
    remainingToday: remainingTodayIndex >= 0 ? Number(matchedRow[remainingTodayIndex] || 0) : 0,
  };
}

export async function fetchAssignmentsByStudentId(
  studentId: string
): Promise<SheetReadingAssignmentRow[]> {
  const response = await fetch(READING_ASSIGNMENTS_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch reading assignments: ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const assignmentIdIndex = getIndex('assignment_id');
  const studentIdIndex = getIndex('student_id');
  const articleIdIndex = getIndex('article_id');
  const articleCodeIndex = getIndex('article_code');
  const statusIndex = getIndex('status');
  const assignedDateIndex = getIndex('assigned_date');
  const dueDateIndex = getIndex('due_date');

  console.log('📘 assignments headers:', headers);
  console.log('📘 assignments studentId filter:', studentId);

  return rows
    .slice(1)
    .filter((row) => row[studentIdIndex]?.trim() === studentId)
    .map((row) => ({
      assignmentId: assignmentIdIndex >= 0 ? row[assignmentIdIndex] || '' : '',
      studentId: studentIdIndex >= 0 ? row[studentIdIndex] || '' : '',
      articleId: articleIdIndex >= 0 ? row[articleIdIndex] || '' : '',
      articleCode: articleCodeIndex >= 0 ? row[articleCodeIndex] || '' : '',
      status: statusIndex >= 0 ? row[statusIndex] || '' : '',
      assignedDate: assignedDateIndex >= 0 ? row[assignedDateIndex] || '' : '',
      dueDate: dueDateIndex >= 0 ? row[dueDateIndex] || '' : '',
    }));
}

export async function addReadingHistory(entry: {
  studentId: string;
  articleId: string;
  articleCode: string;
  title: string;
  durationSec?: number;
  notes?: string;
}) {
  const payload = {
    history_id: 'hist_' + Date.now(),
    student_id: entry.studentId,
    article_id: entry.articleId,
    article_code: entry.articleCode,
    title: entry.title,
    status: 'completed',
    completed_at: new Date().toISOString(),
    duration_sec: entry.durationSec ?? 0,
    notes: entry.notes ?? '',
  };

  console.log('📤 addReadingHistory payload:', payload);
  console.log(
    '📤 addReadingHistory url:',
    GOOGLE_APPS_SCRIPT_CONFIG.READING_HISTORY_WEB_APP_URL
  );

  const response = await fetch(
    GOOGLE_APPS_SCRIPT_CONFIG.READING_HISTORY_WEB_APP_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    }
  );

  const text = await response.text();
  console.log('📥 addReadingHistory raw response:', text);

  try {
    return JSON.parse(text);
  } catch {
    return { status: 'unknown', raw: text };
  }
}