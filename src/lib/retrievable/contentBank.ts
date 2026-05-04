import { LearningItem } from '../learning-schema/types';

const STORAGE_KEY = 'vocab_learning_items'; // Pointing to the unified key in db.ts

const SEED_CONTENT: LearningItem[] = [
  {
    id: 'c1',
    chunk: 'December is the last month of the year.',
    chunkTranslation: '十二月是一年之中的最後一個月。',
    focusExpression: 'December',
    languageDirection: 'en-zh',
    topic: 'Months',
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
    id: 'c2',
    chunk: 'I like to eat apples in the morning.',
    chunkTranslation: '我喜歡在早上吃蘋果。',
    focusExpression: 'apples',
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
  }
];

export const contentBank = {
  getAll: (): LearningItem[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_CONTENT));
      return SEED_CONTENT;
    }
    return JSON.parse(data);
  },
  getById: (id: string): LearningItem | undefined => {
    return contentBank.getAll().find(item => item.id === id);
  },
  save: (item: LearningItem) => {
    const items = contentBank.getAll();
    const index = items.findIndex(i => i.id === item.id);
    if (index >= 0) items[index] = item;
    else items.push(item);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  },
  delete: (id: string) => {
    const items = contentBank.getAll().filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  },
  bulkAdd: (newItems: LearningItem[]) => {
    const items = contentBank.getAll();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...items, ...newItems]));
  }
};
