import type { GeneratedTask, StudentTaskResult, TaskTemplate } from './types';
import { contentBank } from './contentBank';
import { templateBank } from './templateBank';

export const retrievalEngine = {
  // Execute template rules to generate a task
  generateTask: (itemId: string, templateId: string, providedTemplate?: TaskTemplate): GeneratedTask | null => {
    const item = contentBank.getById(itemId);
    const template = providedTemplate ||
      templateBank.getSyncedById(templateId) ||
      templateBank.getById(templateId);

    if (!item || !template) return null;

    // 1. Helper for rule-based "with blank" logic
    let chunkWithBlank = item.chunk || '';
    const focus = item.focusExpression || '';
    if (template.mode_code === 'D' && focus) {
      const regex = new RegExp(`\\b${focus}\\b`, 'i');
      chunkWithBlank = (item.chunk || '').replace(regex, '_______');
    }

    // 2. Tag replacement map
    const tags: Record<string, string> = {
      '{{chunk}}': item.chunk || '',
      '{{chunkTranslation}}': item.chunkTranslation || '',
      '{{topic}}': item.topic || '',
      '{{focus}}': focus,
      '{{focus[0]}}': focus[0] || '',
      '{{chunkTranslation[0]}}': (item.chunkTranslation || '')[0] || '',
      '{{chunk_with_blank}}': chunkWithBlank,
      // Legacy tags for compatibility
      '{{english_text}}': item.chunk || '',
      '{{chinese_text}}': item.chunkTranslation || '',
      '{{english_text_with_blank}}': chunkWithBlank
    };

    const applyRules = (rule: string) => {
      let result = rule;
      Object.entries(tags).forEach(([tag, value]) => {
        result = result.replace(new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value ?? '');
      });
      return result;
    };

    // 3. Determine expected output
    let expected_output: string = item.chunk || '';
    if (template.mode_code === 'A') expected_output = item.chunkTranslation || '';
    if (template.mode_code === 'D') expected_output = focus;

    return {
      task_id: `gt_${Date.now()}`,
      template_id: template.template_id,
      content_id: item.id,
      prompt: applyRules(template.prompt_rule),
      expected_output: expected_output,
      hint: applyRules(template.hint_rule),
      feedback: applyRules(template.feedback_rule),
      created_at: new Date().toISOString()
    };
  },

  submitResult: (result: Omit<StudentTaskResult, 'result_id' | 'attempted_at'>): StudentTaskResult => {
    const fullResult: StudentTaskResult = {
      ...result,
      result_id: `res_${Date.now()}`,
      attempted_at: new Date().toISOString()
    };
    console.log('Task Result Submitted:', fullResult);
    return fullResult;
  }
};
