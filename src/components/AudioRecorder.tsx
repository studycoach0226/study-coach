import { useState, useRef } from 'react';
import { startSafeMediaRecorder } from '../lib/audioRecorderUtils';

interface AudioRecorderProps {
  customAudio?: string;
  onSave: (base64: string) => void;
}

export default function AudioRecorder({ customAudio, onSave }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');
  
  const startTimeRef = useRef<number>(0);
  const stopTimeRef = useRef<number>(0);

  const startRecording = async () => {
    try {
      setValidationError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { recorder, mimeType } = await startSafeMediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        // Safari may trigger onstop before all chunks are pushed. Wait 150ms.
        await new Promise(resolve => setTimeout(resolve, 150));

        const finalMimeType = recorder.mimeType || mimeTypeRef.current || 'audio/webm';
        const stopTime = stopTimeRef.current > 0 ? stopTimeRef.current : Date.now();
        const durationMs = stopTime - startTimeRef.current;

        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: finalMimeType }) : null;

        let isValid = true;
        let validationMsg = "";
        let metadataDurationSec = 0;

        if (!blob) {
          isValid = false;
          validationMsg = "Recording failed or was too short. Please record again.";
          console.error(`❌ [DIAGNOSTICS] AudioRecorder validation failed: blob is null.`);
        } else if (blob.size < 1000) {
          isValid = false;
          validationMsg = "Recording failed or was too short. Please record again.";
          console.error(`❌ [DIAGNOSTICS] AudioRecorder validation failed: size is ${blob.size} bytes (too small).`);
        } else if (durationMs < 1000) {
          isValid = false;
          validationMsg = "Recording failed or was too short. Please record again.";
          console.error(`❌ [DIAGNOSTICS] AudioRecorder validation failed: duration is ${durationMs}ms (too short).`);
        } else {
          console.log(`[DIAGNOSTICS] Starting metadata check in AudioRecorder...`);
          const validation = await new Promise<{ isValid: boolean; error?: string; duration?: number; isTimeout?: boolean }>((resolve) => {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.muted = true;

            const cleanup = () => {
              audio.removeEventListener('loadedmetadata', onLoaded);
              audio.removeEventListener('error', onError);
              URL.revokeObjectURL(url);
            };

            const onLoaded = () => {
              const dur = audio.duration;
              cleanup();
              if (isNaN(dur) || dur <= 0 || dur === Infinity) {
                resolve({ isValid: false, error: `Invalid duration (${dur}s)`, duration: dur });
              } else {
                resolve({ isValid: true, duration: dur });
              }
            };

            const onError = () => {
              cleanup();
              resolve({ isValid: false, error: `Audio decode error` });
            };

            audio.addEventListener('loadedmetadata', onLoaded);
            audio.addEventListener('error', onError);
            audio.load();

            setTimeout(() => {
              cleanup();
              resolve({ isValid: true, duration: 0, isTimeout: true });
            }, 1500);
          });

          if (!validation.isValid) {
            isValid = false;
            validationMsg = "Recording failed or was too short. Please record again.";
            console.error(`❌ [DIAGNOSTICS] AudioRecorder metadata validation failed: ${validation.error}`);
          } else {
            metadataDurationSec = validation.duration || 0;
            console.log(`✅ [DIAGNOSTICS] AudioRecorder metadata validation passed: ${metadataDurationSec}s`);
          }
        }

        const sizeVal = blob ? blob.size : 0;
        if (!isValid) {
          console.error(`❌ [DIAGNOSTICS-SUMMARY] uploadBlocked=true | mimeType="${finalMimeType}" | blobSize=${sizeVal} | durationMs=${durationMs} | metadataDurationSec=${metadataDurationSec}`);
          setValidationError(validationMsg);
          return;
        }

        console.log(`✅ [DIAGNOSTICS-SUMMARY] uploadBlocked=false | mimeType="${finalMimeType}" | blobSize=${sizeVal} | durationMs=${durationMs} | metadataDurationSec=${metadataDurationSec}`);

        const reader = new FileReader();
        reader.readAsDataURL(blob!);
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            onSave(reader.result);
          }
        };
      };

      startTimeRef.current = Date.now();
      stopTimeRef.current = 0;
      recorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("[AudioRecorder] Error starting recording:", err);
      setValidationError(`Recording failed: ${err.message || "Microphone access denied."}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      stopTimeRef.current = Date.now();
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
      <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
        {isRecording ? (
          <button onClick={stopRecording} className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fee2e2', color: '#dc2626', borderColor: '#dc2626' }}>
            ⏹ Stop
          </button>
        ) : (
          <button onClick={startRecording} className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff' }}>
            🎙 {customAudio ? 'Re-record' : 'Record'}
          </button>
        )}
      </div>
      {validationError && (
        <div style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 'bold', marginTop: '0.1rem' }}>
          ⚠️ {validationError}
        </div>
      )}
    </div>
  );
}
