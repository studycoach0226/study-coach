export function buildMeaningPrompt(word: string, articleText: string): string {
  return `
You are an expert English-to-Traditional-Chinese translator.
Please explain the precise Traditional Chinese meaning of the target word based strictly on its usage in the provided article context.

Rules:
1. Return ONLY the short Traditional Chinese meaning.
2. Do NOT provide long explanations, pronunciation, or example sentences.
3. Your answer should be brief (e.g., "政府", "說服", "地區的").

Target word: "${word}"
Article context:
"${articleText}"
`;
}
