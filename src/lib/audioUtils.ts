// src/lib/audioUtils.ts

// Pre-load voices if possible
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
}

export function getPreferredVoice(lang: 'en-US' | 'zh-TW'): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  
  if (lang === 'en-US') {
    return voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha') || v.name === 'Alex') 
        || voices.find(v => v.lang.startsWith('en')) 
        || null;
  } 
  
  if (lang === 'zh-TW') {
    return voices.find(v => v.lang.includes('zh') && (v.name.includes('Google') || v.name.includes('Ting-Ting') || v.name.includes('Mei-Jia') || v.name.includes('Sin-ji'))) 
        || voices.find(v => v.lang.startsWith('zh')) 
        || null;
  }
  
  return null;
}

export function playUnifiedAudio(text: string, customAudio?: string, lang: 'en-US' | 'zh-TW' = 'en-US') {
  if (customAudio && lang === 'en-US') {
    const audio = new Audio(customAudio);
    audio.play();
    return;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    
    const trySpeak = () => {
      const bestVoice = getPreferredVoice(lang);
      if (bestVoice) {
         utterance.voice = bestVoice;
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
