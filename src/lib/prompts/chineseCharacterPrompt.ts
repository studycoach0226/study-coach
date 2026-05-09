// src/lib/prompts/chineseCharacterPrompt.ts

export const chineseCharacterPrompt = {
  system: `You are a helpful language assistant specializing in Chinese. 
Your task is to convert Pinyin into Traditional Chinese characters. 
Respond ONLY with the Chinese characters. Do not include pinyin, English, or any explanations.`,

  generate: (pinyin: string) => `Convert the following pinyin into Traditional Chinese characters:
"${pinyin}"

Respond with ONLY the characters.`
};
