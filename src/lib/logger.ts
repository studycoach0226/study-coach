import { ConnectionFields } from './learning-schema/types';

const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbycI_GWyebdl0wS3g7xByOvKMNuAbCBqU__EA5_DvoSlKKWUE92h6Zs4bBwIfxGwkXJkA/exec';

export type FlashcardLogData = {
  student_id: string;
  student_name: string;
  card_id: string;
  targetExpression: string;
  pronunciation: string;
  meaning: string;
  learningMode: 'englishLearner' | 'chineseLearner';
  source: 'my_flashcards';
  action: 'encoding_completed';
  encoding_status: 'completed';
  context: string;
  contextMeaning: string;
  connections: ConnectionFields;
  created_at: string;
};

export async function logFlashcardCreation(data: FlashcardLogData) {
  try {
    const payload = {
      ...data,
      pronunciation: data.pronunciation || '',
      context: data.context || '',
      contextMeaning: data.contextMeaning || '',
      // Flatten connections or send as object depending on script expectation
      // Here we keep it as an object but ensure all standard fields are mapped
      connections: {
        looksLike: data.connections?.looksLike || '',
        soundsLike: data.connections?.soundsLike || '',
        similarMeaning: data.connections?.similarMeaning || '',
        oppositeMeaning: data.connections?.oppositeMeaning || '',
        usageContext: data.connections?.usageContext || '',
        story: data.connections?.story || '',
        personalSentence: data.connections?.personalSentence || '',
        imageUrl: data.connections?.imageUrl || '',
        imageNote: data.connections?.imageNote || '',
        customChunk: data.connections?.customChunk || '',
        customTranslation: data.connections?.customTranslation || '',
        customFocusExpression: data.connections?.customFocusExpression || '',
        pronunciation: data.connections?.pronunciation || '',
        sentenceMeaning: data.connections?.sentenceMeaning || ''
      }
    };

    await fetch(GOOGLE_SHEETS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('Logging to Google Sheets failed:', error);
  }
}
