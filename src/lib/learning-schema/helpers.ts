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
  
  const manualCount = validConnectionFields.filter(v => !!v && typeof v === 'string' && v.trim() !== '').length;
  const aiCount = (connections.aiConnections || []).length;
  const totalCount = manualCount + aiCount;
  
  if (totalCount < 2) {
    missing.push(`At least 2 connections (you have ${totalCount})`);
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
): any {
  return studentConnections[field] || teacherConnections[field];
}

/**
 * Counts how many unique connection fields have been filled by the student.
 */
export function countStudentConnections(connections: ConnectionFields): number {
  const manualFields = Object.entries(connections).filter(([key, value]) => {
    if (key === 'imageUrl' || key === 'imageNote' || key === 'aiConnections') return false;
    return !!value;
  }).length;
  
  const hasVisual = !!(connections.imageUrl || connections.imageNote);
  const aiCount = (connections.aiConnections || []).length;
  
  return manualFields + (hasVisual ? 1 : 0) + aiCount;
}
