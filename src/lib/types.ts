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

export interface WritingTask {
  id: string;
  title: string;
  promptText: string;
  images?: string[];
  suggestedWordCount?: number;
  createdAt?: number;
  updatedAt?: number;
  isDeleted?: boolean;
}

export interface StudentWriting {
  studentId: string;
  taskId: string;
  draftText: string;
  submittedText: string;
  aiFeedback: string;
  status: 'not_started' | 'drafting' | 'submitted' | 'reviewed';
  createdAt?: number;
  updatedAt?: number;
}
