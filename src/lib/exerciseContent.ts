import {
  GOOGLE_SHEETS_CONFIG,
  SHEET_NAMES,
  EXERCISE_QUESTIONS_FIELDS,
  EXERCISE_ASSIGNMENTS_FIELDS,
} from './appConfig';

export type SheetExerciseQuestion = {
  id: string;
  exerciseCode: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  wordRange: string;
  difficulty: string;
  tags: string[];
};

export type SheetExerciseAssignment = {
  assignmentId: string;
  studentId: string;
  exerciseCode: string;
  assignedAt: string;
  dueDate: string;
  status: string;
};

const SPREADSHEET_ID = GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID;

const EXERCISE_QUESTIONS_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAMES.EXERCISE_QUESTIONS}`;

const EXERCISE_ASSIGNMENTS_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAMES.EXERCISE_ASSIGNMENTS}`;

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

export async function fetchAllExercises(): Promise<SheetExerciseQuestion[]> {
  const response = await fetch(EXERCISE_QUESTIONS_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch exercises: ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const idIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.ID);
  const exerciseCodeIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.EXERCISE_CODE);
  const questionTextIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.QUESTION_TEXT);
  const optionAIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.OPTION_A);
  const optionBIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.OPTION_B);
  const optionCIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.OPTION_C);
  const optionDIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.OPTION_D);
  const correctAnswerIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.CORRECT_ANSWER);
  const wordRangeIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.WORD_RANGE);
  const difficultyIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.DIFFICULTY);
  const tagsIndex = getIndex(EXERCISE_QUESTIONS_FIELDS.TAGS);

  return rows
    .slice(1)
    .filter((row) => row[idIndex]?.trim())
    .map((row) => ({
      id: row[idIndex] || '',
      exerciseCode: exerciseCodeIndex >= 0 ? row[exerciseCodeIndex] || '' : '',
      questionText: questionTextIndex >= 0 ? row[questionTextIndex] || '' : '',
      optionA: optionAIndex >= 0 ? row[optionAIndex] || '' : '',
      optionB: optionBIndex >= 0 ? row[optionBIndex] || '' : '',
      optionC: optionCIndex >= 0 ? row[optionCIndex] || '' : '',
      optionD: optionDIndex >= 0 ? row[optionDIndex] || '' : '',
      correctAnswer: correctAnswerIndex >= 0 ? row[correctAnswerIndex] || '' : '',
      wordRange: wordRangeIndex >= 0 ? row[wordRangeIndex] || '' : '',
      difficulty: difficultyIndex >= 0 ? row[difficultyIndex] || '' : '',
      tags: tagsIndex >= 0 ? (row[tagsIndex] || '').split(',').map(t => t.trim()).filter(Boolean) : [],
    }));
}

export async function fetchExerciseById(id: string): Promise<SheetExerciseQuestion | null> {
  const exercises = await fetchAllExercises();
  return exercises.find((ex) => ex.id === id) || null;
}

export async function fetchExerciseAssignmentsByStudentId(studentId: string): Promise<SheetExerciseAssignment[]> {
  console.log('[DEBUG] Worksheet name requested:', SHEET_NAMES.EXERCISE_ASSIGNMENTS);
  console.log('[DEBUG] Request URL:', EXERCISE_ASSIGNMENTS_CSV_URL);

  const response = await fetch(EXERCISE_ASSIGNMENTS_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    console.error('[DEBUG] Fetch failed:', response.status);
    throw new Error(`Failed to fetch exercise assignments: ${response.status}`);
  }

  const csvText = await response.text();
  console.log('[DEBUG] Raw CSV response:', csvText.substring(0, 500));
  
  const rows = parseCsv(csvText);
  console.log('[DEBUG] Rows parsed:', rows.length);
  if (rows.length > 0) {
    console.log('[DEBUG] Normalized headers:', rows[0].map(normalizeHeader));
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const assignmentIdIndex = getIndex(EXERCISE_ASSIGNMENTS_FIELDS.ASSIGNMENT_ID);
  const studentIdIndex = getIndex(EXERCISE_ASSIGNMENTS_FIELDS.STUDENT_ID);
  const exerciseCodeIndex = getIndex(EXERCISE_ASSIGNMENTS_FIELDS.EXERCISE_CODE);
  const assignedAtIndex = getIndex(EXERCISE_ASSIGNMENTS_FIELDS.ASSIGNED_AT);
  const dueDateIndex = getIndex(EXERCISE_ASSIGNMENTS_FIELDS.DUE_DATE);
  const statusIndex = getIndex(EXERCISE_ASSIGNMENTS_FIELDS.STATUS);

  return rows
    .slice(1)
    .filter((row) => row[studentIdIndex]?.trim() === studentId)
    .map((row) => ({
      assignmentId: assignmentIdIndex >= 0 ? row[assignmentIdIndex] || '' : '',
      studentId: row[studentIdIndex] || '',
      exerciseCode: exerciseCodeIndex >= 0 ? row[exerciseCodeIndex] || '' : '',
      assignedAt: assignedAtIndex >= 0 ? row[assignedAtIndex] || '' : '',
      dueDate: dueDateIndex >= 0 ? row[dueDateIndex] || '' : '',
      status: statusIndex >= 0 ? row[statusIndex] || '' : '',
    }));
}
