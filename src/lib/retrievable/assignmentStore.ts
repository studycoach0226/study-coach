import { StudentAssignment } from './types';

const STORAGE_KEY = 'retrievable_student_assignments';
const STORAGE_KEY_SYNCED = 'retrievable_student_assignments_synced';
const LAST_SYNCED_KEY = 'retrievable_student_assignments_last_sync';

export const assignmentStore = {
  getAll: (): StudentAssignment[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      const parsed = data ? JSON.parse(data) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  },
  getByStudentId: (studentId: string): StudentAssignment | undefined => {
    return assignmentStore.getAll().find(a => a.student_id === studentId);
  },
  getSyncedByStudentId: (studentId: string): StudentAssignment | undefined => {
    try {
      const data = localStorage.getItem(STORAGE_KEY_SYNCED);
      const allSynced: StudentAssignment[] = data ? JSON.parse(data) : [];
      if (!Array.isArray(allSynced)) return undefined;
      return allSynced.find(a => a.student_id === studentId);
    } catch { return undefined; }
  },
  save: (assignment: StudentAssignment) => {
    const all = assignmentStore.getAll();
    const index = all.findIndex(a => a.student_id === assignment.student_id);
    if (index >= 0) all[index] = assignment;
    else all.push(assignment);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },
  getOrCreate: (studentId: string): StudentAssignment => {
    const existing = assignmentStore.getByStudentId(studentId);
    if (existing) return existing;
    
    const newAssignment: StudentAssignment = {
      assignment_id: `as_${Date.now()}`,
      student_id: studentId,
      learning_item_ids: [],
      template_ids: [],
      updated_at: new Date().toISOString()
    };
    assignmentStore.save(newAssignment);
    return newAssignment;
  },
  removeContent: (studentId: string, itemId: string) => {
    const assignment = assignmentStore.getByStudentId(studentId);
    if (assignment) {
      if (!Array.isArray(assignment.learning_item_ids)) assignment.learning_item_ids = [];
      assignment.learning_item_ids = assignment.learning_item_ids.filter(id => id !== itemId);
      assignment.updated_at = new Date().toISOString();
      assignmentStore.save(assignment);
    }
  },
  syncToStudents: (studentId: string) => {
    const currentAll = assignmentStore.getAll();
    const currentSyncedData = localStorage.getItem(STORAGE_KEY_SYNCED);
    const allSynced: StudentAssignment[] = currentSyncedData ? JSON.parse(currentSyncedData) : [];
    
    const draft = currentAll.find(a => a.student_id === studentId);
    if (!draft) return;

    const index = allSynced.findIndex(a => a.student_id === studentId);
    if (index >= 0) allSynced[index] = draft;
    else allSynced.push(draft);

    localStorage.setItem(STORAGE_KEY_SYNCED, JSON.stringify(allSynced));
    localStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
  },
  syncAllToStudents: () => {
    const currentAll = assignmentStore.getAll();
    localStorage.setItem(STORAGE_KEY_SYNCED, JSON.stringify(currentAll));
    localStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
  },
  hasUnsyncedChanges: (studentId: string): boolean => {
    const draft = JSON.stringify(assignmentStore.getByStudentId(studentId));
    const synced = JSON.stringify(assignmentStore.getSyncedByStudentId(studentId));
    return draft !== synced;
  },
  getLastSynced: (): string | null => {
    return localStorage.getItem(LAST_SYNCED_KEY);
  }
};
