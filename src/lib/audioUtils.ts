// src/lib/audioUtils.ts

export type VoicePreference = 'female' | 'male' | 'system';

// Pre-load voices if possible
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
}

export function getAvailableGenders(lang: 'en-US' | 'zh-TW'): ('female' | 'male')[] {
  if (!('speechSynthesis' in window)) return ['female'];
  const voices = window.speechSynthesis.getVoices();
  const matchesLang = (v: SpeechSynthesisVoice) => {
    if (lang === 'en-US') return v.lang.startsWith('en');
    if (lang === 'zh-TW') return v.lang.includes('zh') && (v.lang.includes('TW') || v.lang.includes('HK') || v.lang.includes('CHT'));
    return false;
  };

  const filtered = voices.filter(matchesLang);
  const hasMale = filtered.some(v => 
    v.name.includes('Alex') || v.name.includes('Daniel') || v.name.includes('Fred') || 
    v.name.includes('Oliver') || v.name.includes('Rishi') || 
    v.name.toLowerCase().includes('male')
  );
  const hasFemale = filtered.some(v => 
    v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Karen') || 
    v.name.includes('Tessa') || v.name.includes('Google US English') || 
    v.name.toLowerCase().includes('female')
  );

  const genders: ('female' | 'male')[] = [];
  if (hasFemale) genders.push('female');
  if (hasMale) genders.push('male');
  
  if (genders.length === 0) return ['female'];
  return genders;
}

export function getPreferredVoice(lang: 'en-US' | 'zh-TW', preference: VoicePreference = 'system'): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  
  if (voices.length === 0) return null;

  const matchesLang = (v: SpeechSynthesisVoice) => {
    if (lang === 'en-US') return v.lang.startsWith('en');
    if (lang === 'zh-TW') return v.lang.includes('zh') && (v.lang.includes('TW') || v.lang.includes('HK') || v.lang.includes('CHT'));
    return false;
  };

  const filteredVoices = voices.filter(matchesLang);

  if (preference === 'female') {
    return filteredVoices.find(v => v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Karen') || v.name.includes('Tessa') || v.name.includes('Google US English') || v.name.includes('Ting-Ting') || v.name.includes('Mei-Jia')) 
        || filteredVoices.find(v => v.name.toLowerCase().includes('female'))
        || filteredVoices[0] || null;
  }

  if (preference === 'male') {
    return filteredVoices.find(v => v.name.includes('Alex') || v.name.includes('Daniel') || v.name.includes('Fred') || v.name.includes('Oliver') || v.name.includes('Rishi') || v.name.includes('Sin-ji')) 
        || filteredVoices.find(v => v.name.toLowerCase().includes('male'))
        || null; // Return null if no male voice found to avoid faking it
  }

  // System default
  return filteredVoices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha') || v.name === 'Alex') 
      || filteredVoices[0] 
      || null;
}

export function playUnifiedAudio(
  text: string, 
  customAudio?: string, 
  lang: 'en-US' | 'zh-TW' = 'en-US', 
  preference: VoicePreference = 'system',
  source?: string
) {
  // If we have a custom recording, play it regardless of language
  if (customAudio) {
    if (source) {
      console.log(`[DEBUG] ${source} | Playing custom audio via playUnifiedAudio`);
    }
    const audio = new Audio(customAudio);
    audio.play();
    return;
  }

  // Fallback to TTS
  if ('speechSynthesis' in window && text) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    const trySpeak = () => {
      const bestVoice = getPreferredVoice(lang, preference);
      if (bestVoice) {
         utterance.voice = bestVoice;
      }

      if (source) {
        console.log(`[DEBUG] TTS Playback from: ${source}`);
        console.log(`[DEBUG] Spoken text: ${text}`);
        console.log(`[DEBUG] Selected voice: ${bestVoice?.name || 'default'}`);
        console.log(`[DEBUG] Lang: ${utterance.lang}, Rate: ${utterance.rate}, Pitch: ${utterance.pitch}`);
      }
      
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      const handleVoicesChanged = () => {
        trySpeak();
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      };
      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    } else {
      trySpeak();
    }
  }
}

export function playCardAIVoice(
  audioUrls: any,
  item: any,
  record: any,
  type: 'focusExpression' | 'chunk',
  learnerType: 'english' | 'chinese',
  voicePref: VoicePreference = 'system',
  source: string = 'Unknown'
) {
  const url = type === 'focusExpression' ? audioUrls?.aiWord : audioUrls?.aiChunk;
  const lang = learnerType === 'chinese' ? 'zh-TW' : 'en-US';

  if (url) {
    console.log(`[DEBUG] ${source} | Playing existing AI audio URL:`, url);
    playUnifiedAudio('', url, lang, voicePref, source);
    return;
  }

  // Fallback to TTS
  let ttsText = type === 'focusExpression' 
    ? (record?.studentConnections?.customFocusExpression || item?.focusExpression)
    : (record?.studentConnections?.customChunk || item?.chunk);

  if (learnerType === 'chinese') {
     if (type === 'focusExpression') {
       ttsText = record?.studentConnections?.targetText || record?.targetText || item?.targetText || item?.focusExpression;
     } else {
       ttsText = record?.studentConnections?.contextText || record?.contextText || item?.contextText || item?.chunk;
     }
  }

  if (ttsText) {
    playUnifiedAudio(ttsText, undefined, lang, voicePref, source);
  } else {
    console.warn(`[DEBUG] ${source} | No text found for TTS fallback`);
  }
}
