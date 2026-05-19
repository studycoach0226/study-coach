import {
  collection,
  updateDoc,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, listAll, deleteObject } from 'firebase/storage';
import { firestore, storage } from './firebase';
import { ChunkRecord, ChunkItem } from './learning-schema/types';

/**
 * Recursively removes undefined values from an object before saving to Firestore.
 * Firestore does not support undefined values.
 */
export function sanitizeForFirestore(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle Arrays
  if (Array.isArray(obj)) {
    return obj.map(v => sanitizeForFirestore(v)).filter(v => v !== undefined);
  }

  // Handle Objects
  const sanitized: any = {};
  Object.keys(obj).forEach(key => {
    const value = sanitizeForFirestore(obj[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  });
  return sanitized;
}

/**
 * Helper to upload a base64 string to Firebase Storage and return the download URL.
 * Handles both Data URLs (images) and raw base64 (audio).
 */
export async function uploadAsset(base64: string, path: string): Promise<string> {
  if (!base64 || base64.startsWith('http')) return base64; // Already a URL or empty

  const storageRef = ref(storage, path);
  // uploadString handles data_url format automatically
  const format = base64.startsWith('data:') ? 'data_url' : 'base64';
  const snapshot = await uploadString(storageRef, base64, format);
  return await getDownloadURL(snapshot.ref);
}

export function getFlashcardDocId(studentId: string, learningItemId: string) {
  return `${studentId}_${learningItemId}`;
}

/**
 * NEW Structure Path Helpers
 */
export function getStudentFlashcardsPath(studentId: string) {
  return `students/${studentId}/flashcards`;
}

export function getStudentRetrievalLogsPath(studentId: string) {
  return `students/${studentId}/retrievalLogs`;
}

export async function saveFlashcard(record: ChunkRecord, item: ChunkItem) {
  try {
    console.log('[DEBUG] Firestore-only test mode');

    // 1. Audio Assets
    const audioUrls = record.audioUrls || {};

    // 2. Skip Upload Image (Temporary Debug)
    let imageUrl = '';

    // Determine encoding status
    const status = record.encodingStatus || (record.encodingCompleted ? 'done' : 'pending');

    // Requirement: Determine target path (New structure vs Legacy)
    // 1. If we already have a firebasePath, use it.
    // 2. Otherwise, check if this is a NEW record or if it exists in Legacy.
    let docRef;
    let targetPath = record.firebasePath;
    const compositeDocId = record.firebaseDocId || getFlashcardDocId(record.studentId, record.learningItemId);

    if (targetPath) {
      docRef = doc(firestore, targetPath);
    } else {
      // For NEW records or those without paths yet, we prefer the NEW structure
      // REQUIREMENT: Use composite ID for the document name in the new structure as well
      const newPath = `${getStudentFlashcardsPath(record.studentId)}/${compositeDocId}`;
      const legacyRef = doc(firestore, 'learningRecords', compositeDocId);
      
      // Check if it exists in legacy first to avoid duplicates
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        docRef = legacyRef;
        targetPath = `learningRecords/${compositeDocId}`;
      } else {
        docRef = doc(firestore, newPath);
        targetPath = newPath;
      }
    }

    // Safety Requirement: Do not overwrite completed records with pending
    if (status === 'pending') {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const existingData = docSnap.data();
        const existingStatus = existingData.encodingStatus || (existingData.encodingCompleted || existingData.isConnectionBuilt ? 'done' : 'pending');
        if (existingStatus === 'done') {
          console.log('[DEBUG] Existing record is "done", skipping overwrite with "pending"');
          return { id: docRef.id, path: targetPath };
        }
      }
    }

    // 3. Prepare flattened document for Firestore as requested
    const firestoreData = {
      studentId: record.studentId,
      learningItemId: record.learningItemId,
      targetExpression: record.studentConnections.customFocusExpression || item.focusExpression,
      targetText: record.studentConnections.targetText || item.targetText || '',
      meaning: record.studentConnections.customTranslation || item.chunkTranslation,
      learningMode: item.languageDirection === 'zh-en' ? 'chineseLearner' : 'englishLearner',
      encodingStatus: status,
      encodingCompleted: status === 'done',
      isConnectionBuilt: status === 'done', // Requirement: Keep isConnectionBuilt in sync
      connections: {
        looksLike: record.studentConnections.looksLike || '',
        soundsLike: record.studentConnections.soundsLike || '',
        similarMeaning: record.studentConnections.similarMeaning || '',
        oppositeMeaning: record.studentConnections.oppositeMeaning || '',
        usageContext: record.studentConnections.usageContext || '',
        story: record.studentConnections.story || '',
        personalSentence: record.studentConnections.personalSentence || '',
        imageNote: record.studentConnections.imageNote || ''
      },
      context: record.studentConnections.customChunk || item.chunk,
      contextText: record.studentConnections.contextText || item.contextText || '',
      contextMeaning: record.studentConnections.sentenceMeaning || item.sentenceMeaning || '',
      selectedConnections: record.studentConnections.selectedConnections || [],
      audioUrls,
      imageUrl,  // Empty
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      // Keep original record ID for lookup during updates
      localRecordId: record.id
    };

    console.log(`[DEBUG] Writing document to Firestore`);
    console.log(`[DEBUG] Student ID: ${record.studentId}`);
    console.log(`[DEBUG] Record ID: ${record.learningItemId}`);
    console.log(`[DEBUG] Target Path: ${targetPath}`);

    const sanitizedData = sanitizeForFirestore(firestoreData);
    console.log('[DEBUG] Sanitized payload before Firestore write:', sanitizedData);

    // setDoc with { merge: true } acts as an upsert
    await setDoc(docRef, sanitizedData, { merge: true });

    console.log('[DEBUG] Firestore save success');

    return { id: docRef.id, path: targetPath };
  } catch (error) {
    console.error('Error saving flashcard to Firestore:', error);
    throw error;
  }
}

export async function updateFlashcard(record: ChunkRecord, updates: Partial<any>) {
  try {
    const targetPath = record.firebasePath || `learningRecords/${record.firebaseDocId || getFlashcardDocId(record.studentId, record.learningItemId)}`;
    const docRef = doc(firestore, targetPath);
    
    const sanitizedUpdates = sanitizeForFirestore({
      ...updates,
      updatedAt: serverTimestamp()
    });
    console.log(`[DEBUG] Sanitized updates before Firestore update. Path: ${targetPath}`, sanitizedUpdates);
    await updateDoc(docRef, sanitizedUpdates);
  } catch (error) {
    console.error('Error updating flashcard in Firestore:', error);
    throw error;
  }
}

export async function getStudentFlashcards(studentId: string) {
  try {
    console.log(`[DEBUG] Fetching flashcards for student: ${studentId} (Dual-path mode)`);
    
    // 1. Fetch from NEW structure
    const newPath = getStudentFlashcardsPath(studentId);
    const newQ = query(collection(firestore, newPath));
    const newSnap = await getDocs(newQ);
    const newRecords: any[] = newSnap.docs.map(doc => ({
      firestoreId: doc.id,
      firebasePath: `${newPath}/${doc.id}`,
      ...doc.data()
    }));

    // 2. Fetch from LEGACY structure
    const legacyQ = query(collection(firestore, 'learningRecords'), where('studentId', '==', studentId));
    const legacySnap = await getDocs(legacyQ);
    const legacyRecords: any[] = legacySnap.docs.map(doc => ({
      firestoreId: doc.id,
      firebasePath: `learningRecords/${doc.id}`,
      ...doc.data()
    }));

    // Merge results, prioritizing NEW structure in case of ID overlap
    // REQUIREMENT: Filter out soft-deleted cards
    const combined: any[] = [...newRecords].filter(r => !r.deleted);
    const seenItemIds = new Set(combined.map(r => r.learningItemId));
    
    legacyRecords.forEach(r => {
      if (!seenItemIds.has(r.learningItemId) && !r.deleted) {
        combined.push(r);
      } else if (seenItemIds.has(r.learningItemId)) {
        console.log(`[DEBUG] Skipping legacy record for ${r.learningItemId} because newer one exists.`);
      }
    });

    console.log(`[DEBUG] Combined records count: ${combined.length} (${newRecords.length} new, ${legacyRecords.length} legacy)`);
    return combined;
  } catch (error) {
    console.error('Error fetching flashcards from Firestore:', error);
    throw error;
  }
}

export async function getFlashcardRecord(studentId: string, learningItemId: string): Promise<any | null> {
  try {
    const compositeDocId = getFlashcardDocId(studentId, learningItemId);
    // Check NEW path first
    const newPath = `${getStudentFlashcardsPath(studentId)}/${compositeDocId}`;
    const newRef = doc(firestore, newPath);
    const newSnap = await getDoc(newRef);
    if (newSnap.exists()) {
       const data = newSnap.data();
       if (data.deleted) return null;
       return { firestoreId: newSnap.id, firebasePath: newPath, ...data };
    }

    // Fallback to LEGACY
    const legacyDocId = getFlashcardDocId(studentId, learningItemId);
    const legacyRef = doc(firestore, 'learningRecords', legacyDocId);
    const legacySnap = await getDoc(legacyRef);
    if (legacySnap.exists()) {
      const data = legacySnap.data();
      if (data.deleted) return null;
      return { firestoreId: legacySnap.id, firebasePath: `learningRecords/${legacyDocId}`, ...data };
    }
    return null;
  } catch (error) {
    console.error('Error fetching single flashcard from Firestore:', error);
    throw error;
  }
}

export async function deleteFlashcardFromCloud(studentId: string, learningItemId: string, firebasePath?: string) {
  try {
    // 1. Delete Firestore document
    // Use explicit path if provided, otherwise check both
    let docRef;
    if (firebasePath) {
      docRef = doc(firestore, firebasePath);
    } else {
      const compositeDocId = getFlashcardDocId(studentId, learningItemId);
      const newPath = `${getStudentFlashcardsPath(studentId)}/${compositeDocId}`;
      const newRef = doc(firestore, newPath);
      const newSnap = await getDoc(newRef);
      if (newSnap.exists()) {
        docRef = newRef;
      } else {
        const legacyDocId = compositeDocId;
        docRef = doc(firestore, 'learningRecords', legacyDocId);
      }
    }
    
    const targetPath = docRef.path;
    // REQUIREMENT: Hard delete for flashcard document
    console.log(`[DEBUG] Hard-deleting flashcard document: ${targetPath}`);
    await deleteDoc(docRef);
    console.log(`[DEBUG] Hard delete success for: ${targetPath}`);

    // 2. Delete all related Storage audio files (studentAudio/{studentId}/{wordId}/*)
    try {
      const folderPath = `studentAudio/${studentId}/${learningItemId}`;
      const folderRef = ref(storage, folderPath);
      const listAllItems = await listAll(folderRef);
      
      const deletePromises = listAllItems.items.map(itemRef => deleteObject(itemRef));
      await Promise.all(deletePromises);
      
      console.log(`[DEBUG] Storage cleanup success for: ${folderPath} (${listAllItems.items.length} files)`);
    } catch (storageError) {
      // Requirement: If Storage delete fails, do NOT block flashcard deletion.
      console.warn('[DEBUG] Storage cleanup failed (non-blocking):', storageError);
    }
  } catch (error) {
    console.error('Error deleting flashcard from Firestore:', error);
  }
}

export async function logRetrievalAttempt(studentId: string, logData: any, record: ChunkRecord) {
  try {
    const flashcardPath = record.firebasePath || `learningRecords/${record.firebaseDocId || getFlashcardDocId(studentId, record.learningItemId)}`;
    const flashcardRef = doc(firestore, flashcardPath);
    
    // REQUIREMENT 4: Read current state first to avoid arrayUnion duplicates/instability
    const docSnap = await getDoc(flashcardRef);
    if (!docSnap.exists()) {
      throw new Error(`Flashcard not found at path: ${flashcardPath}`);
    }
    
    const docData = docSnap.data();
    const history = docData.retrievalHistory || [];
    console.log(`[DEBUG] Previous retrievalHistory length: ${history.length}`);

    const isCorrect = logData.isCorrect;
    const now = new Date().toISOString();
    const randomSuffix = Math.floor(Math.random() * 10000);
    const attemptId = `attempt_${Date.now()}_${randomSuffix}`;

    // 1. Prepare attempt object
    const newAttempt = sanitizeForFirestore({
      attemptId,
      createdAt: now,
      practiceMode: logData.practiceMode,
      direction: logData.direction,
      isCorrect: isCorrect,
      studentAnswer: logData.studentAnswer || null,
      expectedAnswer: logData.expectedAnswer || null
    });

    // 2. Append to history
    const updatedHistory = [...history, newAttempt];
    
    // 3. Recalculate summary fields based on full history
    const correctCount = updatedHistory.filter((a: any) => a.isCorrect === true).length;
    const incorrectCount = updatedHistory.filter((a: any) => a.isCorrect === false).length;
    
    const updates = {
      retrievalHistory: updatedHistory,
      retrievalCount: updatedHistory.length,
      correctCount,
      incorrectCount,
      lastRetrievedAt: serverTimestamp(),
      lastResult: isCorrect ? 'correct' : 'incorrect',
      updatedAt: serverTimestamp()
    };

    console.log(`[DEBUG] Target flashcard path: ${flashcardPath}`);
    console.log(`[DEBUG] New retrievalHistory length: ${updatedHistory.length}`);
    console.log(`[DEBUG] Summary counts - Total: ${updatedHistory.length}, Correct: ${correctCount}, Incorrect: ${incorrectCount}`);

    await updateDoc(flashcardRef, updates);
    console.log('[DEBUG] Flashcard update success (Full History Sync)');

  } catch (error) {
    console.error('Error logging retrieval attempt to flashcard:', error);
    throw error;
  }
}

/**
 * Maps a flattened Firestore document back to the { item, record } structure
 * expected by the application UI components.
 */
export function mapFirestoreToLocal(docData: any): { item: ChunkItem, record: ChunkRecord } {
  // Backward compatibility: If encodingStatus is missing, infer it
  const derivedStatus = docData.encodingStatus || (docData.encodingCompleted || docData.isConnectionBuilt ? 'done' : 'pending');

  const urls = docData.audioUrls || {};
  // Requirement 1: map legacy to studentWord/studentChunk without deleting old fields
  const mappedAudioUrls = {
    ...urls,
    studentWord: urls.studentWord || urls.focusExpression || urls.word,
    studentChunk: urls.studentChunk || urls.chunk,
    aiWord: urls.aiWord,
    aiChunk: urls.aiChunk
  };

  const isChineseLearner = docData.learningMode === 'chineseLearner';
  let focusExpression = docData.targetExpression || '';
  let targetText = docData.targetText || '';
  const pronunciation = docData.pronunciation || '';

  if (isChineseLearner) {
    if (!focusExpression && pronunciation) {
      focusExpression = pronunciation;
    } else if (focusExpression && pronunciation && !targetText) {
      // If focusExpression contains Chinese characters, it was likely used for characters in old format
      if (/[\u4e00-\u9fa5]/.test(focusExpression)) {
        targetText = focusExpression;
        focusExpression = pronunciation;
      }
    }
  }

  const item: ChunkItem = {
    id: docData.learningItemId,
    itemType: 'chunk',
    languageDirection: isChineseLearner ? 'zh-en' : 'en-zh',
    focusExpression,
    targetText,
    chunkTranslation: docData.meaning,
    pronunciation: docData.pronunciation || '',
    chunk: docData.context,
    contextText: docData.contextText || '',
    sentenceMeaning: docData.contextMeaning || '',
    createdBy: 'system',
    assignedByTeacher: true,
    assignedToAll: true,
    assignedStudentIds: [],
    createdAt: docData.createdAt?.toMillis ? docData.createdAt.toMillis() : Date.now(),
    updatedAt: docData.updatedAt?.toMillis ? docData.updatedAt.toMillis() : Date.now(),
    teacherConnections: {}
  };

  const record: ChunkRecord = {
    id: docData.localRecordId || docData.firestoreId,
    studentId: docData.studentId,
    learningItemId: docData.learningItemId,
    status: derivedStatus === 'done' ? 'completed' : 'new',
    savedToLibrary: true,
    encodingCompleted: derivedStatus === 'done',
    encodingStatus: derivedStatus,
    isConnectionBuilt: derivedStatus === 'done',
    studentConnections: {
      ...docData.connections,
      imageUrl: docData.imageUrl || '',
      selectedConnections: docData.selectedConnections || [],
      customFocusExpression: focusExpression,
      targetText: targetText,
      customChunk: docData.context,
      contextText: docData.contextText || '',
      customTranslation: docData.meaning,
      pronunciation: docData.pronunciation || '',
      sentenceMeaning: docData.contextMeaning || '',
    },
    audioUrls: mappedAudioUrls,
    firebaseDocId: docData.firestoreId,
    firebasePath: docData.firebasePath,
    startedAt: docData.createdAt?.toMillis ? docData.createdAt.toMillis() : Date.now(),
    updatedAt: docData.updatedAt?.toMillis ? docData.updatedAt.toMillis() : Date.now(),
    // REQUIREMENT: Map summary fields for reporting and retrieval visibility
    retrievalCount: docData.retrievalCount || 0,
    correctCount: docData.correctCount || 0,
    incorrectCount: docData.incorrectCount || 0,
    lastRetrievedAt: docData.lastRetrievedAt?.toMillis ? docData.lastRetrievedAt.toMillis() : null,
    lastResult: docData.lastResult || null,
    retrievalHistory: docData.retrievalHistory || []
  };

  return { item, record };
}

export async function logToneAttempt(
  studentId: string,
  logData: {
    audioUrl: string | null;
    audioMimeType: string | null;
    uploadError?: boolean;
    selectedPipelineVersion: string;
    processedUserCurve: number[];
    targetCurve?: number[];
    selfRating: number;
    selfRatingLabel: string;
    score?: number | null;
  },
  record: ChunkRecord
) {
  try {
    const flashcardPath = record.firebasePath || `learningRecords/${record.firebaseDocId || getFlashcardDocId(studentId, record.learningItemId)}`;
    const flashcardRef = doc(firestore, flashcardPath);
    
    const docSnap = await getDoc(flashcardRef);
    if (!docSnap.exists()) {
      throw new Error(`Flashcard not found at path: ${flashcardPath}`);
    }
    
    const docData = docSnap.data();
    const history = docData.retrievalHistory || [];
    console.log(`[DEBUG] Previous retrievalHistory length (for tone): ${history.length}`);

    const isCorrect = logData.selfRating >= 3; // 3 = Good, 4 = Very confident
    const now = new Date().toISOString();
    const randomSuffix = Math.floor(Math.random() * 10000);
    const attemptId = `attempt_${Date.now()}_${randomSuffix}`;

    const newAttempt = sanitizeForFirestore({
      attemptId,
      createdAt: now,
      practiceMode: 'tonePractice',
      isCorrect,
      selfRating: logData.selfRating,
      selfRatingLabel: logData.selfRatingLabel,
      audioUrl: logData.audioUrl || null,
      audioMimeType: logData.audioMimeType || null,
      uploadError: logData.uploadError || null,
      selectedPipelineVersion: logData.selectedPipelineVersion,
      processedUserCurve: logData.processedUserCurve,
      targetCurve: logData.targetCurve || null,
      score: logData.score || null
    });

    const updatedHistory = [...history, newAttempt];
    const correctCount = updatedHistory.filter((a: any) => a.isCorrect === true).length;
    const incorrectCount = updatedHistory.filter((a: any) => a.isCorrect === false).length;

    const updates = {
      retrievalHistory: updatedHistory,
      retrievalCount: updatedHistory.length,
      correctCount,
      incorrectCount,
      lastRetrievedAt: serverTimestamp(),
      lastResult: isCorrect ? 'correct' : 'incorrect',
      updatedAt: serverTimestamp()
    };

    console.log(`[DEBUG] Logging tone attempt: ${attemptId}, rating: ${logData.selfRatingLabel}`);
    await updateDoc(flashcardRef, updates);
    console.log('[DEBUG] Tone attempt logged successfully in Firestore');
  } catch (error) {
    console.error('Error logging tone attempt:', error);
    throw error;
  }
}

