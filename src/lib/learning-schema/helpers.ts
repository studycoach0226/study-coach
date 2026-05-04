import { ConnectionFields, StudentLearningRecord } from './types';

/**
 * Validates if the student has completed the required encoding steps.
 * Requirement: Chunk audio AND Focus audio (if focus text exists) AND at least 2 text/visual connections.
 */
export function validateEncoding(record: StudentLearningRecord): { 
  isValid: boolean; 
  missing: string[];
} {
  // If encoding has been confirmed completed, respect the state recursively 
  if (record.encodingCompleted) {
    return { isValid: true, missing: [] };
  }

  const missing: string[] = [];
  
  const hasChunkAudio = !!(record.audioUrls?.focusExpression || record.audioUrls?.word);
  
  if (!hasChunkAudio) {
    missing.push('Chunk Pronunciation');
  }
  
  const connections = record.studentConnections || {};
  const validConnectionFields = [
    connections.looksLike,
    connections.soundsLike,
    connections.similarMeaning,
    connections.oppositeMeaning,
    connections.usageContext,
    connections.story,
    connections.imageUrl
  ];
  
  const connectionCount = validConnectionFields.filter(v => !!v && v.trim() !== '').length;
  
  if (connectionCount < 2) {
    missing.push(`At least 2 connections (you have ${connectionCount})`);
  }
  
  return {
    isValid: missing.length === 0,
    missing
  };
}

/**
 * Gets the "effective" connection value, prioritizing student input over teacher guidance.
 * This is useful for displaying teacher scaffolding while allowing student overrides.
 */
export function getEffectiveConnection(
  field: keyof ConnectionFields,
  teacherConnections: ConnectionFields,
  studentConnections: ConnectionFields
): string | undefined {
  return studentConnections[field] || teacherConnections[field];
}

/**
 * Counts how many unique connection fields have been filled by the student.
 */
export function countStudentConnections(connections: ConnectionFields): number {
  const textFields = Object.entries(connections).filter(([key, value]) => {
    if (key === 'imageUrl' || key === 'imageNote') return false;
    return !!value;
  }).length;
  
  const hasVisual = !!(connections.imageUrl || connections.imageNote);
  return textFields + (hasVisual ? 1 : 0);
}
