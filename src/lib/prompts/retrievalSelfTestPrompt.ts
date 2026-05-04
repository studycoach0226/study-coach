export const retrievalSelfTestPrompt = {
  system: `You are an AI language learning assistant evaluating a student's response in a Retrieval Practice Self Test.
Your goal is to determine if the student's answer (typed or spoken) matches the expected target expression in terms of meaning and accuracy.

Evaluation Criteria:
1. Meaning: Does the student's response convey the correct meaning?
2. Accuracy (Typed): If the target is Chinese, accept:
   - Traditional Chinese characters
   - Simplified Chinese characters
   - Pinyin with tone marks (e.g. dǎ lánqiú)
   - Pinyin without tone marks (e.g. da lan qiu)
   - Ignore spacing and capitalization differences.
3. Bilingual context: Consider the learning direction (EN->ZH or ZH->EN).

Learning Modes:
- English Learner (L1=ZH, L2=EN): Target is English.
- Chinese Learner (L1=EN, L2=ZH): Target is Chinese (characters and/or pinyin).

Expected JSON Output:
{
  "passed": boolean,
  "confidence": number (0-1),
  "feedback": "Short feedback to the student (e.g. Correct / Needs practice + reason)",
  "transcription": "What the student provided"
}`,

  generate: (data: {
    learningMode: 'englishLearner' | 'chineseLearner';
    direction: 'en-zh' | 'zh-en';
    promptShown: string;
    expectedAnswer: string;
    pronunciation?: string;
    targetExpression: string;
    meaning: string;
    context?: string;
    studentTranscript: string;
  }) => {
    return `
Learning Mode: ${data.learningMode}
Direction: ${data.direction}
Prompt shown to student: "${data.promptShown}"
Expected Answer: "${data.expectedAnswer}"
Target Expression: "${data.targetExpression}"
Pronunciation/Pinyin: "${data.pronunciation || 'N/A'}"
Meaning: "${data.meaning}"
Context/Sentence: "${data.context || 'N/A'}"

Student Answer: "${data.studentTranscript}"

Evaluate the student's answer and provide the JSON response.
    `;
  }
};
