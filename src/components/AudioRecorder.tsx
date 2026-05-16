import { useState, useRef } from 'react';
import { startSafeMediaRecorder } from '../lib/audioRecorderUtils';

interface AudioRecorderProps {
  customAudio?: string;
  onSave: (base64: string) => void;
}

export default function AudioRecorder({ customAudio, onSave }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { recorder, mimeType } = await startSafeMediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            onSave(reader.result);
          }
        };
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("[AudioRecorder] Error starting recording:", err);
      alert(`Recording failed: ${err.message || "Microphone access denied or an error occurred."}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
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
  );
}
