// src/lib/aiService.ts
import { buildMeaningPrompt } from "./prompts/wordMeaningPrompt";
import { buildReadingExplainPrompt } from "./prompts/readingExplainPrompt";
import { buildReadingReadPrompt } from "./prompts/readingReadPrompt";
import { retrievalSelfTestPrompt } from "./prompts/retrievalSelfTestPrompt";
import { connectionSuggestionsPrompt } from "./prompts/connectionSuggestionsPrompt";
import { chineseCharacterPrompt } from "./prompts/chineseCharacterPrompt";
import { SelectedConnection } from "./learning-schema/types";

/**
 * Generates a contextual Chinese meaning for a given word within an article.
 * 
 * @param word The vocabulary word marked by the student
 * @param articleText The full text of the article to provide context
 * @returns A promise that resolves to the contextual Chinese meaning
 */
export async function generateMeaningFromContext(word: string, articleText: string): Promise<string> {
  const apiKey = (import.meta as any).env.VITE_OPENAI_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('❌ OpenAI API Key is missing. Please set VITE_OPENAI_API_KEY in your .env file.');
    return '（AI 尚未設定）';
  }

  const prompt = buildMeaningPrompt(word, articleText);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      })
    });

    if (!response.ok) {
      console.error(`❌ OpenAI API Error: ${response.status} ${response.statusText}`);
      return '（AI 無法取得意思）';
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ Failed to fetch meaning from OpenAI:', error);
    return '（AI 無法取得意思）';
  }
}

export type ComprehensionFeedback = {
  type: "comprehension";
  score: number;
  transcriptionText: string;
  completionScore?: number;
  completionFeedback?: string;
  accuracyScore?: number;
  accuracyFeedback?: string;
  detailScore?: number;
  detailFeedback?: string;
  clarityScore?: number;
  clarityFeedback?: string;
  strengths?: string;
  needsWork?: string;
  understandingFeedback?: string;
  missingPoints?: string;
  suggestion?: string;
};

export type PronunciationFeedback = {
  type: "pronunciation";
  score: number;
  transcriptionText: string;
  completenessFeedback: string;
  pronunciationFeedback: string;
  fluencyFeedback: string;
  missingOrChangedWords: string;
  suggestion: string;
};

export type EvaluationFeedback = ComprehensionFeedback | PronunciationFeedback;

/**
 * Evaluates student recording (either explain or read) based on taskType.
 */
export async function evaluateRecording(params: {
  audioBlobOrBase64: string | Blob;
  targetText: string;
  taskType: "explain" | "read";
}): Promise<EvaluationFeedback> {
  const apiKey = (import.meta as any).env.VITE_OPENAI_API_KEY;

  const defaultErrorResponse = (suggestion: string): EvaluationFeedback => {
    if (params.taskType === 'explain') {
      return { type: 'comprehension', score: 0, transcriptionText: '', understandingFeedback: '', missingPoints: '', suggestion };
    }
    return { type: 'pronunciation', score: 0, transcriptionText: '', completenessFeedback: '', pronunciationFeedback: '', fluencyFeedback: '', missingOrChangedWords: '', suggestion };
  };

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('❌ OpenAI API Key is missing.');
    return defaultErrorResponse('AI 尚未設定');
  }

  try {
    // 1. Convert audio to Blob
    let audioBlob: Blob;
    if (typeof params.audioBlobOrBase64 === 'string') {
      const res = await fetch(params.audioBlobOrBase64);
      audioBlob = await res.blob();
    } else {
      audioBlob = params.audioBlobOrBase64;
    }

    console.log(`[evaluateRecording] audio blob size: ${audioBlob.size} bytes`);
    console.log(`[evaluateRecording] audio mimeType: ${audioBlob.type}`);

    let extension = 'webm';
    if (audioBlob.type.includes('mp4')) extension = 'mp4';
    else if (audioBlob.type.includes('aac')) extension = 'aac';
    else if (audioBlob.type.includes('ogg')) extension = 'ogg';

    // 2. Transcribe Audio (Whisper)
    const formData = new FormData();
    formData.append('file', audioBlob, `speech.${extension}`);
    // Using the exact model requested by user
    formData.append('model', 'gpt-4o-mini-transcribe');

    const transcribeRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!transcribeRes.ok) {
      console.error(`❌ OpenAI Transcription Error: ${transcribeRes.status} ${transcribeRes.statusText}`);
      // Fallback if the user's custom model name fails, try whisper-1
      if (transcribeRes.status === 404 || transcribeRes.status === 400) {
        console.warn("Model gpt-4o-mini-transcribe might be invalid. Please consider using 'whisper-1' for transcription.");
      }
      return defaultErrorResponse('語音辨識失敗');
    }

    const transcribeData = await transcribeRes.json();
    const transcriptionText = transcribeData.text || '';
    console.log(`[evaluateRecording] transcript value before evaluation: "${transcriptionText}"`);

    if (!transcriptionText.trim()) {
      console.warn(`[evaluateRecording] Transcript is empty, returning early.`);
      return defaultErrorResponse('請再錄一次，確認麥克風有收音。');
    }

    // 3. AI Evaluation (Chat Completions)
    let prompt = '';
    if (params.taskType === 'explain') {
      prompt = buildReadingExplainPrompt(params.targetText, transcriptionText);
    } else {
      prompt = buildReadingReadPrompt(params.targetText, transcriptionText);
    }

    const payload = {
      model: 'gpt-4.1-mini', // As requested
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    };
    
    console.log(`[evaluateRecording] AI evaluation payload:`, JSON.stringify(payload, null, 2));

    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!chatRes.ok) {
      console.error(`❌ OpenAI Chat Error: ${chatRes.status} ${chatRes.statusText}`);
      return defaultErrorResponse('AI 評估失敗');
    }

    const chatData = await chatRes.json();
    const content = chatData.choices[0].message.content.trim();

    // Parse JSON safely in case it returns markdown formatting
    const cleanedJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanedJson);
    console.log(`[evaluateRecording] AI evaluation result:`, result);

    if (params.taskType === 'explain') {
      // Calculate average if score is missing
      const completionScore = result.completionScore || 0;
      const accuracyScore = result.accuracyScore || 0;
      const detailScore = result.detailScore || 0;
      const clarityScore = result.clarityScore || 0;
      
      const calculatedScore = Math.round((completionScore + accuracyScore + detailScore + clarityScore) / 4);
      
      let finalScore = 0;
      if (result.score !== undefined) finalScore = result.score;
      else if (result.overallScore !== undefined) finalScore = result.overallScore;
      else if (result.totalScore !== undefined) finalScore = result.totalScore;
      else finalScore = calculatedScore;

      return {
        type: 'comprehension',
        score: finalScore,
        transcriptionText: transcriptionText,
        completionScore: completionScore,
        completionFeedback: result.completionFeedback,
        accuracyScore: accuracyScore,
        accuracyFeedback: result.accuracyFeedback,
        detailScore: detailScore,
        detailFeedback: result.detailFeedback,
        clarityScore: clarityScore,
        clarityFeedback: result.clarityFeedback,
        strengths: result.strengths,
        needsWork: result.needsWork,
      };
    } else {
      return {
        type: 'pronunciation',
        score: result.score || 0,
        transcriptionText: transcriptionText,
        completenessFeedback: result.completenessFeedback || '',
        pronunciationFeedback: result.pronunciationFeedback || '',
        fluencyFeedback: result.fluencyFeedback || '',
        missingOrChangedWords: result.missingOrChangedWords || '',
        suggestion: result.suggestion || '',
      };
    }
  } catch (error) {
    console.error('❌ AI Evaluation Error:', error);
    return defaultErrorResponse('語音辨識或評估失敗');
  }
}

/**
 * Evaluates student typed answer using AI.
 */
export async function evaluateTypedAnswer(params: {
  studentAnswer: string;
  expectedAnswer: string;
  promptShown: string;
  direction: 'en-zh' | 'zh-en';
  learningMode: 'englishLearner' | 'chineseLearner';
  targetExpression: string;
  pronunciation?: string;
  meaning: string;
  context?: string;
}): Promise<{ passed: boolean; feedback: string }> {
  const apiKey = (import.meta as any).env.VITE_OPENAI_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('❌ OpenAI API Key is missing.');
    return { passed: false, feedback: 'AI 尚未設定' };
  }

  const prompt = retrievalSelfTestPrompt.generate({
    learningMode: params.learningMode,
    direction: params.direction,
    promptShown: params.promptShown,
    expectedAnswer: params.expectedAnswer,
    pronunciation: params.pronunciation,
    targetExpression: params.targetExpression,
    meaning: params.meaning,
    context: params.context,
    studentTranscript: params.studentAnswer
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: retrievalSelfTestPrompt.system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
      })
    });

    if (!response.ok) {
      console.error(`❌ OpenAI Chat Error: ${response.status}`);
      return { passed: false, feedback: 'AI 評估失敗' };
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    const cleanedJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanedJson);

    return {
      passed: result.passed,
      feedback: result.feedback
    };
  } catch (error) {
    console.error('❌ Typed AI Evaluation Error:', error);
    return { passed: false, feedback: 'AI 評估失敗' };
  }
}

const SPEECH_API_BASE = (import.meta as any).env.VITE_SPEECH_API_BASE || "http://localhost:8000";

export async function generateConnectionSuggestions(params: {
  word: string;
  learningLanguage: string;
  nativeLanguage: string;
  chunk: string;
  sentence: string;
  knownWords: string[];
}): Promise<Omit<SelectedConnection, 'id' | 'source' | 'createdAt' | 'updatedAt' | 'studentComment'>[]> {
  console.log(`[AI Suggestions] Triggered request via backend proxy for word: "${params.word}"`);

  try {
    const response = await fetch(`${SPEECH_API_BASE}/ai/connection_suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });

    console.log(`[AI Suggestions] Response status from proxy: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) {
        errorBody = '(could not parse error body)';
      }
      console.error(`❌ Backend AI Suggestions Error: ${response.status} - Body: ${errorBody}`);
      return [];
    }

    const result = await response.json();
    console.log(`[AI Suggestions] Successful. Parsed suggestions count: ${result.length}`);
    return result;
  } catch (error) {
    console.error('❌ AI Connection Suggestions Error:', error);
    return [];
  }
}

export async function generateChineseCharacters(pinyin: string): Promise<string> {
  const apiKey = (import.meta as any).env.VITE_OPENAI_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('❌ OpenAI API Key is missing.');
    return '';
  }

  const prompt = chineseCharacterPrompt.generate(pinyin);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: chineseCharacterPrompt.system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
      })
    });

    if (!response.ok) {
      console.error(`❌ OpenAI Chat Error: ${response.status}`);
      return '';
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ AI Chinese Character Generation Error:', error);
    return '';
  }
}
