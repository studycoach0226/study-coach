import { TaskTemplate } from './types';

const STORAGE_KEY = 'retrievable_template_bank';
const STORAGE_KEY_SYNCED = 'retrievable_template_bank_synced';
const LAST_SYNCED_KEY = 'retrievable_template_bank_last_sync';

const SEED_TEMPLATES: TaskTemplate[] = [
  {
    template_id: 'tA',
    template_name: 'Translation (EN to ZH)',
    mode_code: 'A',
    description: 'Translate the English sentence into Chinese.',
    input_fields_needed: ['english_text'],
    prompt_rule: 'Translate: {{english_text}}',
    output_type: 'text',
    hint_rule: 'First character: {{chinese_text[0]}}',
    scoring_rule: 'exact_match',
    feedback_rule: 'Correct translation is: {{chinese_text}}',
    enabled: true
  },
  {
    template_id: 'tB',
    template_name: 'Translation (ZH to EN)',
    mode_code: 'B',
    description: 'Translate the Chinese sentence into English.',
    input_fields_needed: ['chinese_text'],
    prompt_rule: 'Translate: {{chinese_text}}',
    output_type: 'text',
    hint_rule: 'First word: {{english_text.split(" ")[0]}}',
    scoring_rule: 'levenshtein_distance',
    feedback_rule: 'Correct translation is: {{english_text}}',
    enabled: true
  },
  {
    template_id: 'tD',
    template_name: 'Fill in the Blanks',
    mode_code: 'D',
    description: 'Fill in the missing word in the sentence.',
    input_fields_needed: ['english_text', 'keywords'],
    prompt_rule: 'Complete the sentence: {{english_text_with_blank}}',
    output_type: 'text',
    hint_rule: 'The missing word starts with {{keyword[0]}}',
    scoring_rule: 'exact_match',
    feedback_rule: 'The correct word was {{keyword}}',
    enabled: true
  },
  {
    template_id: 'tS',
    template_name: 'Repeat (Shadowing)',
    mode_code: 'S' as any,
    description: 'Listen to the English and repeat it.',
    input_fields_needed: ['english_text'],
    prompt_rule: 'Listen and repeat: {{english_text}}',
    output_type: 'voice',
    hint_rule: 'Try to match the rhythm and intonation.',
    scoring_rule: 'voice_similarity',
    feedback_rule: 'Well done! You repeated: {{english_text}}',
    enabled: true
  }
];

export const templateBank = {
  getAll: (): TaskTemplate[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_TEMPLATES));
      return SEED_TEMPLATES;
    }
    return JSON.parse(data);
  },
  getSynced: (): TaskTemplate[] => {
    const data = localStorage.getItem(STORAGE_KEY_SYNCED);
    return data ? JSON.parse(data) : [];
  },
  getSyncedById: (id: string): TaskTemplate | undefined => {
    return templateBank.getSynced().find(t => t.template_id === id);
  },
  getById: (id: string): TaskTemplate | undefined => {
    return templateBank.getAll().find(t => t.template_id === id);
  },
  save: (template: TaskTemplate) => {
    const templates = templateBank.getAll();
    const index = templates.findIndex(t => t.template_id === template.template_id);
    if (index >= 0) templates[index] = template;
    else templates.push(template);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  },
  delete: (id: string) => {
    const templates = templateBank.getAll().filter(t => t.template_id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  },
  duplicate: (id: string) => {
    const t = templateBank.getById(id);
    if (t) {
      const copy = { ...t, template_id: `t_${Date.now()}`, template_name: `${t.template_name} (Copy)` };
      templateBank.save(copy);
    }
  },
  bulkAdd: (newTemplates: TaskTemplate[]) => {
    const templates = templateBank.getAll();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...templates, ...newTemplates]));
  },
  syncToStudents: () => {
    const current = templateBank.getAll();
    localStorage.setItem(STORAGE_KEY_SYNCED, JSON.stringify(current));
    localStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
  },
  hasUnsyncedChanges: (): boolean => {
    const current = JSON.stringify(templateBank.getAll());
    const synced = JSON.stringify(templateBank.getSynced());
    return current !== synced;
  },
  getLastSynced: (): string | null => {
    return localStorage.getItem(LAST_SYNCED_KEY);
  }
};
