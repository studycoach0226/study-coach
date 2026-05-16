export const getSupportedMimeType = (): string => {
  const types = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/aac',
    'audio/ogg;codecs=opus'
  ];

  if (typeof MediaRecorder === 'undefined') {
    console.error("[AudioRecorder] MediaRecorder is not supported in this browser.");
    return '';
  }

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`[AudioRecorder] Supported MIME type found: ${type}`);
      return type;
    }
  }

  console.log("[AudioRecorder] No preferred MIME type supported, falling back to default.");
  return '';
};

export const startSafeMediaRecorder = async (stream: MediaStream): Promise<{ recorder: MediaRecorder, mimeType: string }> => {
  console.log("[AudioRecorder] User Agent:", navigator.userAgent);
  
  if (typeof MediaRecorder === 'undefined') {
    throw new Error("MediaRecorder is not supported on this browser/device.");
  }

  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : undefined;
  
  try {
    const recorder = new MediaRecorder(stream, options);
    console.log(`[AudioRecorder] MediaRecorder initialized with mimeType: ${recorder.mimeType || 'default'}`);
    return { recorder, mimeType: recorder.mimeType || mimeType || 'audio/mp4' };
  } catch (err: any) {
    console.error("[AudioRecorder] Failed to initialize MediaRecorder with options", options, err);
    console.log("[AudioRecorder] Attempting Blob fallback recording strategy (default MediaRecorder)...");
    
    // Blob fallback recording strategy: Try without options
    const fallbackRecorder = new MediaRecorder(stream);
    console.log(`[AudioRecorder] Fallback MediaRecorder initialized with mimeType: ${fallbackRecorder.mimeType || 'default'}`);
    return { recorder: fallbackRecorder, mimeType: fallbackRecorder.mimeType || 'audio/mp4' };
  }
};
