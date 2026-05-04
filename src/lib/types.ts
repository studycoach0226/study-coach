export * from './learning-schema/types';

export type Role = 'student' | 'teacher';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Attempt {
  id: string;
  studentId: string;
  wordId: string; // Refers to LearningItem.id
  date: string;
  passed: boolean;
  usedHint: boolean;
}
