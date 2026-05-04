import { GOOGLE_SHEETS_CONFIG, SHEET_NAMES, STUDENTS_FIELDS } from './appConfig';

export type SheetStudent = {
  studentId: string;
  studentName: string;
  loginCode: string;
  status: string;
  notes: string;
  studentUrl: string;
};

const SPREADSHEET_ID = GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID;
const STUDENTS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAMES.STUDENTS}`;

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

export async function fetchAllStudents(): Promise<SheetStudent[]> {
  const response = await fetch(STUDENTS_CSV_URL, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch students: ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const getIndex = (name: string) => headers.indexOf(name);

  const studentIdIndex = getIndex(STUDENTS_FIELDS.studentId);
  const studentNameIndex = getIndex(STUDENTS_FIELDS.studentName);
  const loginCodeIndex = getIndex(STUDENTS_FIELDS.loginCode);
  const statusIndex = getIndex(STUDENTS_FIELDS.status);
  const notesIndex = getIndex(STUDENTS_FIELDS.notes);
  const studentUrlIndex = getIndex(STUDENTS_FIELDS.studentUrl);

  return rows
    .slice(1)
    .filter((row) => row[studentIdIndex]?.trim())
    .map((row) => ({
      studentId: row[studentIdIndex] || '',
      studentName: row[studentNameIndex] || '',
      loginCode: loginCodeIndex >= 0 ? row[loginCodeIndex] || '' : '',
      status: statusIndex >= 0 ? row[statusIndex] || '' : '',
      notes: notesIndex >= 0 ? row[notesIndex] || '' : '',
      studentUrl: studentUrlIndex >= 0 ? row[studentUrlIndex] || '' : '',
    }));
}

export async function fetchStudentById(studentId: string): Promise<SheetStudent | null> {
  const students = await fetchAllStudents();
  return students.find((s) => s.studentId === studentId) || null;
}
