/**
 * Prompt builders for the Listen & Speak module.
 */

export interface PromptContext {
  studentLevel: string;
  learnedContent: string[];
  readingContext?: string;
  mode: 'zh-en' | 'en-zh' | 'qa' | 'transformation';
}

/**
 * Builds the prompt for generating oral practice questions.
 */
export function buildListenSpeakQuestionPrompt(context: PromptContext) {
  const { studentLevel, learnedContent, readingContext, mode } = context;

  let modeInstruction = "";
  switch (mode) {
    case 'zh-en':
      modeInstruction = "Translate the following Chinese meaning into the English phrase or sentence we learned.";
      break;
    case 'en-zh':
      modeInstruction = "Explain the following English phrase or sentence in Chinese, or translate it accurately.";
      break;
    case 'qa':
      modeInstruction = "Answer the following question related to the content you've learned.";
      break;
    case 'transformation':
      modeInstruction = "Transform the sentence as instructed (e.g., change tense, use a synonym, or change from active to passive).";
      break;
  }

  return `
Role: You are an encouraging AI Oral Coach for English learners.
Goal: Generate a single oral practice question based on the student's learned content.

Student Level: ${studentLevel}
Learned Phrases/Units: ${learnedContent.join(', ')}
${readingContext ? `Reading Context: ${readingContext}` : ''}

Task:
- Choose ONE phrase or concept from the learned list.
- Mode: ${modeInstruction}
- Keep the question clear and concise for oral delivery.
- Ensure the difficulty matches the ${studentLevel} level.
- Do not use vocabulary or grammar that is significantly more advanced than what the student has learned.

Output Format (JSON):
{
  "questionText": "The text to be spoken by AI",
  "hint": "A short hint for the student if they get stuck",
  "targetAnswer": "The ideal answer you expect"
}
`;
}

/**
 * Builds the prompt for evaluating student's oral response.
 */
export function buildListenSpeakFeedbackPrompt(question: string, targetAnswer: string, studentTranscript: string) {
  return `
Role: You are an encouraging AI Oral Coach.
Goal: Evaluate the student's oral response and provide constructive feedback.

Original Question: ${question}
Target/Ideal Answer: ${targetAnswer}
Student's Response (Transcript): ${studentTranscript}

Evaluation Criteria:
1. Meaning Accuracy: Did the student convey the correct meaning?
2. Grammar: Are there any major grammatical errors?
3. Fluency/Naturalness: Does the response sound natural?

Feedback Requirements:
- Be encouraging and student-friendly.
- Keep feedback short (2-3 sentences).
- Provide a "Better/Natural Version" of their answer.

Output Format (JSON):
{
  "isCorrect": true/false (based on meaning),
  "feedback": "Encouraging feedback text",
  "improvedVersion": "A more natural or corrected version of the student's response",
  "score": 0-100
}
`;
}
