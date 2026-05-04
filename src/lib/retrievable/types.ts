

export interface TaskTemplate {
  template_id: string;
  template_name: string;
  mode_code: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'S';
  description: string;
  input_fields_needed: string[];
  prompt_rule: string;
  output_type: 'text' | 'voice' | 'choice';
  hint_rule: string;
  scoring_rule: string;
  feedback_rule: string;
  enabled: boolean;
}

export interface GeneratedTask {
  task_id: string;
  template_id: string;
  content_id: string; // Refers to LearningItem.id
  prompt: string;
  expected_output: string;
  hint?: string;
  feedback?: string;
  options?: string[];
  created_at: string;
}

export interface StudentTaskResult {
  result_id: string;
  student_id: string;
  task_id: string;
  student_response: string;
  is_correct: boolean;
  score: number;
  feedback: string;
  attempted_at: string;
  duration_ms: number;
}

export interface StudentAssignment {
  assignment_id: string;
  student_id: string;
  learning_item_ids: string[]; // Renamed from content_ids
  template_ids: string[];
  updated_at: string;
}
