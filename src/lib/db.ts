import { User, LearningItem, StudentLearningRecord, Attempt, RecordStatus, ChunkItem, ChunkRecord } from './types';
import { validateEncoding } from './learning-schema/helpers';
import { saveFlashcard } from './firebaseDb';

const KEYS = {
  USERS: 'vocab_users',
  LEARNING_ITEMS: 'vocab_learning_items',
  LEARNING_RECORDS: 'vocab_learning_records',
  ATTEMPTS: 'vocab_attempts',
};

// --- New Seed Data ---
const SEED_USERS: User[] = [
  { id: 'u1', name: 'Student A', role: 'student' },
  { id: 'u2', name: 'Student B', role: 'student' },
  { id: 't1', name: 'Teacher', role: 'teacher' },
];

const SEED_LEARNING_ITEMS: LearningItem[] = [
  {
    id: 'li1',
    chunk: 'Eat an apple',
    chunkTranslation: '吃一個蘋果',
    focusExpression: 'Apple',
    languageDirection: 'en-zh',
    topic: 'Food',
    difficulty: 'beginner',
    teacherConnections: {
      looksLike: 'Round and red',
      soundsLike: 'A-ple',
    },
    createdBy: 'system',
    assignedByTeacher: true,
    assignedToAll: true,
    assignedStudentIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'li2',
    chunk: 'Peel a banana',
    chunkTranslation: '剝香蕉皮',
    focusExpression: 'Banana',
    languageDirection: 'en-zh',
    topic: 'Food',
    difficulty: 'beginner',
    teacherConnections: {},
    createdBy: 'system',
    assignedByTeacher: true,
    assignedToAll: true,
    assignedStudentIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'reading-test-1',
    itemType: 'reading',
    title: 'Ocean Pollution',
    articleText: 'People in this region are starting to take notice of the trash in the ocean. Although it is hard to control pollution, the government wants to persuade citizens to adopt green habits.',
    languageDirection: 'en-zh',
    createdBy: 'system',
    assignedByTeacher: true,
    assignedToAll: true,
    assignedStudentIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

export function initializeDB() {
  if (!localStorage.getItem(KEYS.USERS)) {
    localStorage.setItem(KEYS.USERS, JSON.stringify(SEED_USERS));
    localStorage.setItem(KEYS.LEARNING_ITEMS, JSON.stringify(SEED_LEARNING_ITEMS));
    localStorage.setItem(KEYS.LEARNING_RECORDS, JSON.stringify([]));
    localStorage.setItem(KEYS.ATTEMPTS, JSON.stringify([]));
  } else {
    // Force insert reading seed data if missing for testing
    try {
      const items = JSON.parse(localStorage.getItem(KEYS.LEARNING_ITEMS) || '[]');
      if (!items.find((i: any) => i.id === 'reading-test-1')) {
        const readingItem = SEED_LEARNING_ITEMS.find(i => i.id === 'reading-test-1');
        if (readingItem) {
          localStorage.setItem(KEYS.LEARNING_ITEMS, JSON.stringify([...items, readingItem]));
        }
      }
    } catch (e) {
      // Ignored
    }
  }
}

// --- Status Calculation Logic ---
export function calculateStatus(attempts: Attempt[], targetAttempts: number = 5, targetPasses: number = 3): RecordStatus {
  if (attempts.length === 0) return 'new';

  const passCount = attempts.filter(a => a.passed && !a.usedHint).length;

  if (attempts.length >= targetAttempts && passCount >= targetPasses) {
    return 'completed';
  }

  if (attempts.length >= targetAttempts && passCount < targetPasses) {
    const passRate = passCount / attempts.length;
    if (passRate < 0.5) return 'weak';
  }

  if (attempts.length < (targetAttempts / 2)) {
    return 'learning';
  }

  return 'practicing';
}

// --- Database Utility Functions ---
export const db = {
  getCurrentUserId: (): string | null => localStorage.getItem('currentUserId'),
  setCurrentUserId: (id: string) => {
    localStorage.setItem('currentUserId', id);
    const user = db.getUsers().find(u => u.id === id);
    if (user) db.setCurrentRole(user.role);
  },
  getCurrentRole: (): string | null => localStorage.getItem('activeRole'),
  setCurrentRole: (role: string) => localStorage.setItem('activeRole', role),
  getLoggedUser: (): User | null => {
    const id = db.getCurrentUserId();
    if (!id) return null;
    return db.getUsers().find(u => u.id === id) || null;
  },
  getUsers: (): User[] => JSON.parse(localStorage.getItem(KEYS.USERS) || '[]'),

  // New API
  getLearningItems: (): LearningItem[] => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEYS.LEARNING_ITEMS) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  },
  getLearningRecords: (): StudentLearningRecord[] => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEYS.LEARNING_RECORDS) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  },

  // Legacy Wrappers (For gradual migration)
  getWords: () => db.getLearningItems()
    .filter(item => item.itemType !== 'reading')
    .map(item => {
      const chunkItem = item as ChunkItem;
      return {
        ...item,
        word: chunkItem.focusExpression,
        meaning: chunkItem.chunkTranslation,
        chineseMeaning: chunkItem.chunkTranslation,
      };
    }),

  getStudentWords: () => {
    const records = db.getLearningRecords();
    return records
      .filter(r => r.itemType !== 'reading')
      .map(r => {
        const chunkRecord = r as ChunkRecord;
        return {
          ...r,
          wordId: r.learningItemId,
          status: r.status as RecordStatus, // Use actual record status
          isOnboarded: chunkRecord.encodingCompleted,
          connections: chunkRecord.studentConnections,
          isEncodingComplete: chunkRecord.encodingCompleted
        };
      });
  },

  getLearningRecord: (studentId: string, learningItemId: string): StudentLearningRecord | undefined => {
    return db.getLearningRecords().find(r => r.studentId === studentId && r.learningItemId === learningItemId);
  },

  saveLearningRecord: (record: StudentLearningRecord) => {
    const list = db.getLearningRecords();
    const existingIndex = list.findIndex(i => i.id === record.id);
    if (existingIndex >= 0) list[existingIndex] = record;
    else list.push(record);
    localStorage.setItem(KEYS.LEARNING_RECORDS, JSON.stringify(list));
  },

  deleteLearningRecord: (id: string) => {
    const list = db.getLearningRecords();
    const remaining = list.filter(i => i.id !== id);
    localStorage.setItem(KEYS.LEARNING_RECORDS, JSON.stringify(remaining));
  },

  addLearningItem: (item: Partial<LearningItem>): string => {
    return db.createLearningItem(item);
  },

  updateLearningItem: (item: LearningItem) => {
    const list = db.getLearningItems();
    const index = list.findIndex(i => i.id === item.id);
    if (index >= 0) {
      list[index] = { ...item, updatedAt: Date.now() };
      localStorage.setItem(KEYS.LEARNING_ITEMS, JSON.stringify(list));
    }
  },

  deleteLearningItem: (id: string) => {
    const list = db.getLearningItems();
    const remaining = list.filter(i => i.id !== id);
    localStorage.setItem(KEYS.LEARNING_ITEMS, JSON.stringify(remaining));
  },

  createLearningItem: (item: Partial<LearningItem>): string => {
    const items = db.getLearningItems();
    const isReading = item.itemType === 'reading';

    const newItem: LearningItem = isReading ? {
      id: 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      itemType: 'reading',
      title: (item as any).title || '',
      articleText: (item as any).articleText || '',
      languageDirection: item.languageDirection || 'en-zh',
      createdBy: item.createdBy || 'teacher',
      assignedByTeacher: item.assignedByTeacher || false,
      assignedToAll: item.assignedToAll || false,
      assignedStudentIds: item.assignedStudentIds || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any : {
      id: 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      itemType: 'chunk',
      chunk: (item as any).chunk || '',
      contextText: (item as any).contextText || '',
      chunkTranslation: (item as any).chunkTranslation || '',
      focusExpression: (item as any).focusExpression || '',
      targetText: (item as any).targetText || '',
      pronunciation: (item as any).pronunciation || '',
      sentenceMeaning: (item as any).sentenceMeaning || '',
      languageDirection: item.languageDirection || 'en-zh',
      teacherConnections: (item as any).teacherConnections || {},
      createdBy: item.createdBy || 'teacher',
      assignedByTeacher: item.assignedByTeacher || false,
      assignedToAll: item.assignedToAll || false,
      assignedStudentIds: item.assignedStudentIds || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any;

    items.push(newItem);
    localStorage.setItem(KEYS.LEARNING_ITEMS, JSON.stringify(items));

    // Also create a record for the student who created it if they are a student
    const sId = db.getCurrentUserId();
    const role = db.getCurrentRole();
    if (sId && role === 'student' && !isReading) {
      const record: ChunkRecord = {
        id: 'lr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        studentId: sId,
        learningItemId: newItem.id,
        itemType: 'chunk',
        studentConnections: {},
        audioUrls: {},
        status: 'new',
        encodingCompleted: false,
        encodingStatus: 'pending',
        isConnectionBuilt: false,
        savedToLibrary: true,
        startedAt: Date.now(),
        updatedAt: Date.now()
      };
      db.saveLearningRecord(record);
      // Immediate cloud sync
      saveFlashcard(record, newItem as ChunkItem).catch(err => {
        console.warn('[DEBUG] Firebase sync failed on creation:', err);
      });
    }

    return newItem.id;
  },

  getOnboardingStatus: (item: LearningItem, record?: StudentLearningRecord) => {
    if (!item) return { isValid: false, missing: ['No item found'] };
    if (!record) return { isValid: false, missing: ['No student record'] };

    return validateEncoding(record);
  },

  isOnboardingComplete: (record?: StudentLearningRecord): boolean => {
    if (!record) return false;
    if (record.itemType === 'reading') return true; // Reading doesn't have onboarding yet
    return (record as ChunkRecord).encodingCompleted || false;
  },

  getAttempts: (): Attempt[] => JSON.parse(localStorage.getItem(KEYS.ATTEMPTS) || '[]'),
  saveAttempt: (attempt: Attempt) => {
    const list = db.getAttempts();
    list.push(attempt);
    localStorage.setItem(KEYS.ATTEMPTS, JSON.stringify(list));
  },

  isWordDue: (studentId: string, itemId: string): boolean => {
    const attempts = db.getAttempts().filter(a => a.studentId === studentId && a.wordId === itemId);
    if (attempts.length === 0) return true;

    const latest = attempts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const twelveHours = 12 * 60 * 60 * 1000;
    return (Date.now() - new Date(latest.date).getTime()) > twelveHours;
  },
};
