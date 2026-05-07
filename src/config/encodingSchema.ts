/**
 * Centralized Encoding Schema Configuration
 * This file defines the stability and structure of all flashcard encoding fields.
 */

export type EncodingFieldType = 'text' | 'textarea' | 'audio' | 'image';

export interface MediaMetadata {
  url: string;
  path: string;
  uploadedAt: number;
  metadata: {
    mimeType: string;
    size: number;
    durationMs?: number;
  };
}

export interface EncodingField {
  fieldKey: string;         // Immutable unique identifier (e.g., 'looks_like_v1')
  label: string;            // User-facing label
  type: EncodingFieldType;
  section: 'identity' | 'connection' | 'context' | 'media';
  isActive: boolean;        // If false, hidden from UI but readable from DB
  required: boolean;
  firestorePath: string;    // Dot-notation path in Firestore (e.g., 'connections.looksLike')
}

export const ENCODING_SCHEMA: EncodingField[] = [
  // --- IDENTITY SECTION ---
  {
    fieldKey: 'custom_focus_expression_v1',
    label: 'Target Expression',
    type: 'text',
    section: 'identity',
    isActive: true,
    required: true,
    firestorePath: 'targetExpression'
  },
  {
    fieldKey: 'custom_translation_v1',
    label: 'Translation',
    type: 'text',
    section: 'identity',
    isActive: true,
    required: true,
    firestorePath: 'meaning'
  },
  {
    fieldKey: 'pronunciation_v1',
    label: 'Pronunciation',
    type: 'text',
    section: 'identity',
    isActive: true,
    required: false,
    firestorePath: 'pronunciation'
  },

  // --- CONNECTION SECTION ---
  {
    fieldKey: 'looks_like_v1',
    label: 'Looks Like',
    type: 'text',
    section: 'connection',
    isActive: true,
    required: false,
    firestorePath: 'connections.looksLike'
  },
  {
    fieldKey: 'sounds_like_v1',
    label: 'Sounds Like',
    type: 'text',
    section: 'connection',
    isActive: true,
    required: false,
    firestorePath: 'connections.soundsLike'
  },
  {
    fieldKey: 'similar_meaning_v1',
    label: 'Similar Meaning',
    type: 'text',
    section: 'connection',
    isActive: true,
    required: false,
    firestorePath: 'connections.similarMeaning'
  },
  {
    fieldKey: 'opposite_meaning_v1',
    label: 'Opposite Meaning',
    type: 'text',
    section: 'connection',
    isActive: true,
    required: false,
    firestorePath: 'connections.oppositeMeaning'
  },
  {
    fieldKey: 'story_v1',
    label: 'Memory Story',
    type: 'textarea',
    section: 'connection',
    isActive: true,
    required: false,
    firestorePath: 'connections.story'
  },

  // --- CONTEXT SECTION ---
  {
    fieldKey: 'usage_context_v1',
    label: 'Usage Context',
    type: 'textarea',
    section: 'context',
    isActive: true,
    required: false,
    firestorePath: 'connections.usageContext'
  },
  {
    fieldKey: 'personal_sentence_v1',
    label: 'Personal Sentence',
    type: 'textarea',
    section: 'context',
    isActive: true,
    required: false,
    firestorePath: 'connections.personalSentence'
  },
  {
    fieldKey: 'custom_chunk_v1',
    label: 'Example Sentence',
    type: 'textarea',
    section: 'context',
    isActive: true,
    required: false,
    firestorePath: 'context'
  },
  {
    fieldKey: 'sentence_meaning_v1',
    label: 'Sentence Meaning',
    type: 'text',
    section: 'context',
    isActive: true,
    required: false,
    firestorePath: 'contextMeaning'
  },

  // --- MEDIA SECTION ---
  {
    fieldKey: 'memory_image_v1',
    label: 'Memory Image',
    type: 'image',
    section: 'media',
    isActive: true,
    required: false,
    firestorePath: 'imageUrl'
  },
  {
    fieldKey: 'image_note_v1',
    label: 'Image Note',
    type: 'text',
    section: 'media',
    isActive: true,
    required: false,
    firestorePath: 'connections.imageNote'
  }
];

/**
 * Returns all active fields for UI rendering
 */
export function getActiveEncodingFields() {
  return ENCODING_SCHEMA.filter(f => f.isActive);
}

/**
 * Returns a specific field definition by its stable key
 */
export function getFieldByKey(key: string) {
  return ENCODING_SCHEMA.find(f => f.fieldKey === key);
}

/**
 * Generates an object with default values for all schema fields
 */
export function getDefaultEncodingValues() {
  const defaults: Record<string, any> = {};
  ENCODING_SCHEMA.forEach(f => {
    defaults[f.fieldKey] = (f.type === 'image' || f.type === 'audio') ? null : '';
  });
  return defaults;
}
