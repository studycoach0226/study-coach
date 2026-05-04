export type LanguageDirection = 'en-zh' | 'zh-en';

export interface ConnectionFields {
  customChunk?: string;
  customTranslation?: string;
  customFocusExpression?: string;
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
}

export interface BaseLearningItem {
  id: string;
  itemType?: 'chunk' | 'reading'; // defaults to chunk if missing
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
  chunk?: string;
  chunkTranslation?: string;
  focusExpression?: string;
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

export type LearningItem = ChunkItem | ReadingItem;

export type RecordStatus = 'new' | 'learning' | 'practicing' | 'weak' | 'completed';

export interface BaseLearningRecord {
  id: string;
  studentId: string;
  learningItemId: string;
  status: RecordStatus;
  savedToLibrary: boolean;
  startedAt: number;
  updatedAt: number;

  // Common fields (optional on base to simplify access in components)
  studentConnections?: ConnectionFields;
  audioUrls?: {
    word?: string;
    chunk?: string;
    focusExpression?: string;
  };
  encodingCompleted?: boolean;
  studentEnglishReadingAudio?: string;
  studentChineseExplanationAudio?: string;
  aiFeedback?: string;
  highlightedIssues?: string[];
}

export interface ChunkRecord extends BaseLearningRecord {
  itemType?: 'chunk';
  studentConnections: ConnectionFields;
  audioUrls: {
    word?: string; // Legacy: deprecated or kept if you want
    chunk?: string;
    focusExpression?: string;
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

export type StudentLearningRecord = ChunkRecord | ReadingRecord;
