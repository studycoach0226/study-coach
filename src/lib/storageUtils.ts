import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';
import { MediaMetadata } from '../config/encodingSchema';

/**
 * Reusable helper to upload a media file (Audio or Image) to Firebase Storage.
 * returns standardized MediaMetadata for Firestore persistence.
 */
export async function uploadMediaFile(
  file: Blob | File,
  storagePath: string,
  durationMs?: number
): Promise<MediaMetadata> {
  const storageRef = ref(storage, storagePath);
  
  // 1. Upload file
  const snapshot = await uploadBytes(storageRef, file);
  
  // 2. Get download URL
  const downloadURL = await getDownloadURL(snapshot.ref);
  
  // 3. Construct standardized metadata
  return {
    url: downloadURL,
    path: storagePath,
    uploadedAt: Date.now(),
    metadata: {
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      durationMs
    }
  };
}

/**
 * Specialized helper for Audio uploads
 */
export async function uploadAudioFile(
  file: Blob | File,
  path: string,
  durationMs?: number
): Promise<MediaMetadata> {
  // Currently just a wrapper around uploadMediaFile
  return uploadMediaFile(file, path, durationMs);
}
