export type LanguageDirection = 'en-zh' | 'zh-en';

export interface SelectedConnection {
  id: string;
  type: string; // The primary category
  relationshipTag: string; // The specific tag or custom tag
  noteLine: string;
  explanation?: string; // Optional teacher explanation
  optionalPronunciation?: string;
  optionalMeaning?: string;
  studentComment?: string;
  source: 'ai' | 'manual';
  createdAt?: number;
  updatedAt?: number;
}

export interface ConnectionFields {
  customFocusExpression?: string;
  targetText?: string;
  customChunk?: string;
  contextText?: string;
  customTranslation?: string;
  looksLike?: string;
  soundsLike?: string;
  similarMeaning?: string;
  oppositeMeaning?: string;
  usageContext?: string;
  personalSentence?: string;
  story?: string;
  imageUrl?: string;
  imageNote?: string;
  pronunciation?: string;
  sentenceMeaning?: string;
  selectedConnections?: SelectedConnection[];
}

export interface BaseLearningItem {
  id: string;
  itemType?: 'chunk' | 'reading' | 'exercise'; // defaults to chunk if missing
  languageDirection: LanguageDirection;
  topic?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  notes?: string;
  createdBy: string;            // 'teacher' | 'student' | 'system'
  assignedByTeacher: boolean;
  assignedToAll: boolean;
  assignedStudentIds: string[];
  createdAt: number;
  updatedAt: number;

  // Common fields (optional on base to simplify access in components)
  focusExpression?: string;
  targetText?: string;
  chunk?: string;
  contextText?: string;
  chunkTranslation?: string;
  teacherConnections?: ConnectionFields;
  title?: string;
  articleText?: string;
  fullMeaningZh?: string;
  pronunciation?: string;
  sentenceMeaning?: string;
  teacherReferenceAudio?: string;
}

export interface ChunkItem extends BaseLearningItem {
  itemType?: 'chunk';
  chunk: string;                // The core unit (word, phrase, or sentence)
  chunkTranslation: string;     // Translation for the core unit
  focusExpression: string;      // The specific part the student is focusing on
  teacherConnections: ConnectionFields;
}

export interface ReadingItem extends BaseLearningItem {
  itemType: 'reading';
  title: string;
  articleText: string;
  fullMeaningZh?: string;
  teacherReferenceAudio?: string;
}

export interface ExerciseItem extends BaseLearningItem {
  itemType: 'exercise';
  questions: {
    id: string;
    text: string;
    options: string[];
    correctAnswer: string;
  }[];
}

export type LearningItem = ChunkItem | ReadingItem | ExerciseItem;

export type RecordStatus = 'new' | 'learning' | 'practicing' | 'weak' | 'completed';

export interface BaseLearningRecord {
  id: string;
  studentId: string;
  learningItemId: string;
  status: RecordStatus;
  savedToLibrary: boolean;
  startedAt: number;
  updatedAt: number;
  firebaseDocId?: string;

  // Common fields (optional on base to simplify access in components)
  studentConnections?: ConnectionFields;
  targetText?: string;
  contextText?: string;
  audioUrls?: {
    word?: string; // Legacy
    chunk?: string; // Legacy
    focusExpression?: string; // Legacy
    aiWord?: string;
    aiChunk?: string;
    studentWord?: string;
    studentChunk?: string;
  };
  encodingCompleted?: boolean;
  studentEnglishReadingAudio?: string;
  studentChineseExplanationAudio?: string;
  aiFeedback?: string;
  highlightedIssues?: string[];
  encodingStatus?: 'pending' | 'done';
  isConnectionBuilt?: boolean; // Keep for backward compatibility/reference
  googleSheetLoggedAt?: number;
}

export interface ChunkRecord extends BaseLearningRecord {
  itemType?: 'chunk';
  studentConnections: ConnectionFields;
  audioUrls: {
    word?: string; // Legacy
    chunk?: string; // Legacy
    focusExpression?: string; // Legacy
    aiWord?: string;
    aiChunk?: string;
    studentWord?: string;
    studentChunk?: string;
  };
  encodingCompleted: boolean;
}

export interface ReadingRecord extends BaseLearningRecord {
  itemType: 'reading';
  studentEnglishReadingAudio?: string;
  studentChineseExplanationAudio?: string;
  aiFeedback?: string; // Phase 2: JSON payload represented as string or any
  highlightedIssues?: string[];
}

export interface ExerciseRecord extends BaseLearningRecord {
  itemType: 'exercise';
  answers: Record<string, string>;
  score?: number;
}

export type StudentLearningRecord = ChunkRecord | ReadingRecord | ExerciseRecord;
