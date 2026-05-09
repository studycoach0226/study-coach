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

export async function saveFlashcard(record: ChunkRecord, item: ChunkItem) {
  try {
    console.log('[DEBUG] Firestore-only test mode');

    // 1. Skip Upload Audio Assets (Temporary Debug)
    const audioUrls: Record<string, string> = {};

    // 2. Skip Upload Image (Temporary Debug)
    let imageUrl = '';

    // Determine encoding status
    const status = record.encodingStatus || (record.encodingCompleted ? 'done' : 'pending');

    // Use a composite ID to ensure upsert behavior and avoid duplicates
    const docId = `${record.studentId}_${record.learningItemId}`;
    const docRef = doc(firestore, 'learningRecords', docId);

    // Safety Requirement: Do not overwrite completed records with pending
    if (status === 'pending') {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const existingData = docSnap.data();
        const existingStatus = existingData.encodingStatus || (existingData.encodingCompleted || existingData.isConnectionBuilt ? 'done' : 'pending');
        if (existingStatus === 'done') {
          console.log('[DEBUG] Existing record is "done", skipping overwrite with "pending"');
          return docId;
        }
      }
    }

    // 3. Prepare flattened document for Firestore as requested
    const firestoreData = {
      studentId: record.studentId,
      learningItemId: record.learningItemId,
      targetExpression: record.studentConnections.customFocusExpression || item.focusExpression,
      meaning: record.studentConnections.customTranslation || item.chunkTranslation,
      pronunciation: record.studentConnections.pronunciation || item.pronunciation || '',
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
      contextMeaning: record.studentConnections.sentenceMeaning || item.sentenceMeaning || '',
      selectedConnections: record.studentConnections.selectedConnections || [],
      audioUrls, // Empty
      imageUrl,  // Empty
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      // Keep original record ID for lookup during updates
      localRecordId: record.id
    };

    console.log(`[DEBUG] Writing document to learningRecords`);
    console.log(`[DEBUG] Attempting to save to Firestore. Collection: 'learningRecords', Doc ID: '${docId}', Student ID: '${record.studentId}', Item ID: '${record.learningItemId}'`);

    // setDoc with { merge: true } acts as an upsert
    await setDoc(docRef, firestoreData, { merge: true });

    console.log('[DEBUG] Firestore save success');

    return docId;
  } catch (error) {
    console.error('Error saving flashcard to Firestore:', error);
    throw error;
  }
}

export async function updateFlashcard(firestoreDocId: string, updates: Partial<any>) {
  try {
    const docRef = doc(firestore, 'learningRecords', firestoreDocId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating flashcard in Firestore:', error);
    throw error;
  }
}

export async function getStudentFlashcards(studentId: string) {
  try {
    const q = query(collection(firestore, 'learningRecords'), where('studentId', '==', studentId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      firestoreId: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching flashcards from Firestore:', error);
    throw error;
  }
}

export async function deleteFlashcardFromCloud(studentId: string, learningItemId: string) {
  try {
    // 1. Delete Firestore document
    const docId = `${studentId}_${learningItemId}`;
    const docRef = doc(firestore, 'learningRecords', docId);
    await deleteDoc(docRef);
    console.log(`[DEBUG] Cloud Firestore delete success for: ${docId}`);

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

/**
 * Maps a flattened Firestore document back to the { item, record } structure
 * expected by the application UI components.
 */
export function mapFirestoreToLocal(docData: any): { item: ChunkItem, record: ChunkRecord } {
  // Backward compatibility: If encodingStatus is missing, infer it
  const derivedStatus = docData.encodingStatus || (docData.encodingCompleted || docData.isConnectionBuilt ? 'done' : 'pending');

  const item: ChunkItem = {
    id: docData.learningItemId,
    itemType: 'chunk',
    languageDirection: docData.learningMode === 'chineseLearner' ? 'zh-en' : 'en-zh',
    focusExpression: docData.targetExpression,
    chunkTranslation: docData.meaning,
    pronunciation: docData.pronunciation || '',
    chunk: docData.context,
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
      selectedConnections: docData.selectedConnections || []
    },
    audioUrls: docData.audioUrls || {},
    startedAt: docData.createdAt?.toMillis ? docData.createdAt.toMillis() : Date.now(),
    updatedAt: docData.updatedAt?.toMillis ? docData.updatedAt.toMillis() : Date.now(),
  };

  return { item, record };
}
