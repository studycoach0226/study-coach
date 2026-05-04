import { useState } from 'react';
import { db } from '../lib/db';

export type GapStatus = "improved" | "still" | "newly_noticed";

export type GapProgressItem = {
  word: string;
  meaningStr: string;
  pronunciation: boolean;
  meaning: boolean;
  status: GapStatus;
  selectedForFlashcard: boolean;
  isTeacherRecommended?: boolean;
};


type FinalSummaryProps = {
  items: GapProgressItem[];
  onItemsChange: (items: GapProgressItem[]) => void;
};

export default function FinalSummary({ items, onItemsChange }: FinalSummaryProps) {
  const [saveSuccess, setSaveSuccess] = useState(false);

  const improvedCount = items.filter(i => i.status === 'improved').length;
  const stillCount = items.filter(i => i.status === 'still').length;
  const newlyNoticedCount = items.filter(i => i.status === 'newly_noticed').length;

  const handleToggle = (word: string) => {
    onItemsChange(
      items.map(item =>
        item.word === word
          ? { ...item, selectedForFlashcard: !item.selectedForFlashcard }
          : item
      )
    );
  };

  const handleMeaningChange = (word: string, newMeaning: string) => {
    onItemsChange(
      items.map(item =>
        item.word === word
          ? { ...item, meaningStr: newMeaning }
          : item
      )
    );
  };

  const handleSaveToFlashcards = () => {
    const selected = items.filter(i => i.selectedForFlashcard);
    if (selected.length === 0) return;

    const missingMeanings = selected.filter(i => !i.meaningStr.trim());
    if (missingMeanings.length > 0) {
      alert("Please provide a meaning for all selected words before saving.");
      return;
    }

    selected.forEach(item => {
      const existingItems = db.getLearningItems();
      const existingItem = existingItems.find(i =>
        (i.focusExpression && i.focusExpression.toLowerCase() === item.word.toLowerCase()) ||
        (i.chunk && i.chunk.toLowerCase() === item.word.toLowerCase())
      );

      const sId = db.getCurrentUserId();
      if (existingItem) {
        // Ensure chunkTranslation is updated if it was previously empty or "-"
        if (!existingItem.chunkTranslation || existingItem.chunkTranslation.trim() === '' || existingItem.chunkTranslation === '-') {
          db.updateLearningItem({
            ...existingItem,
            chunkTranslation: item.meaningStr
          });
        }

        if (sId) {
          const existingRecord = db.getLearningRecord(sId, existingItem.id);
          if (!existingRecord) {
            db.saveLearningRecord({
              id: 'lr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              studentId: sId,
              learningItemId: existingItem.id,
              studentConnections: {},
              audioUrls: {},
              status: 'new',
              encodingCompleted: false,
              savedToLibrary: true,
              startedAt: Date.now(),
              updatedAt: Date.now()
            });
          }
        }
      } else {
        db.createLearningItem({
          itemType: 'chunk',
          chunk: item.word,
          chunkTranslation: item.meaningStr,
          focusExpression: item.word,
          languageDirection: 'en-zh',
          createdBy: 'student',
          assignedByTeacher: false,
          assignedToAll: false,
        });
      }
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div
      className="card"
      style={{
        padding: '1.25rem',
        marginBottom: '1rem',
        background: '#f9fffb',
        border: '1px solid #bbf7d0',
      }}
    >
      <h3 style={{ marginTop: 0 }}>📊 Final Summary & Gap Progress</h3>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.85rem',
          marginTop: '0.85rem',
          marginBottom: '1.25rem'
        }}
      >
        <div style={{ padding: '1rem', borderRadius: '12px', background: '#fff', border: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-muted)' }}>Improved</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#16a34a' }}>{improvedCount}</div>
        </div>
        <div style={{ padding: '1rem', borderRadius: '12px', background: '#fff', border: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-muted)' }}>Still Remaining</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#d97706' }}>{stillCount}</div>
        </div>
        <div style={{ padding: '1rem', borderRadius: '12px', background: '#fff', border: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-muted)' }}>Newly Noticed</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#dc2626' }}>{newlyNoticedCount}</div>
        </div>
      </div>

      <h4 style={{ marginBottom: '0.75rem' }}>Details</h4>

      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No gaps detected.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {items.map(item => (
            <div
              key={item.word}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem',
                borderRadius: '8px',
                background: '#fff',
                border: '1px solid var(--border)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="checkbox"
                  checked={item.selectedForFlashcard}
                  onChange={() => handleToggle(item.word)}
                  style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{item.word}</span>
                    {item.isTeacherRecommended && (
                      <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1d4ed8', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>
                        Teacher recommended
                      </span>
                    )}
                  </div>

                  {item.isTeacherRecommended && item.meaningStr ? (
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '0.2rem' }}>
                      {item.meaningStr}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={item.meaningStr}
                      onChange={(e) => handleMeaningChange(item.word, e.target.value)}
                      placeholder="Enter meaning..."
                      style={{
                        marginTop: '0.35rem',
                        fontSize: '0.9rem',
                        padding: '0.2rem 0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        outline: 'none',
                        borderColor: (!item.meaningStr.trim() && item.selectedForFlashcard) ? '#dc2626' : 'var(--border)'
                      }}
                    />
                  )}
                </div>

                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {item.pronunciation && item.meaning ? 'P + M' : item.pronunciation ? 'P' : 'M'}
                </span>
              </div>

              <div>
                {item.status === 'improved' && (
                  <span style={{ padding: '0.25rem 0.6rem', background: '#dcfce7', color: '#15803d', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 600 }}>
                    Improved
                  </span>
                )}
                {item.status === 'still' && (
                  <span style={{ padding: '0.25rem 0.6rem', background: '#fef3c7', color: '#b45309', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 600 }}>
                    Still
                  </span>
                )}
                {item.status === 'newly_noticed' && (
                  <span style={{ padding: '0.25rem 0.6rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 600 }}>
                    Newly Noticed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <button
          className="btn btn-primary"
          onClick={handleSaveToFlashcards}
          disabled={items.filter(i => i.selectedForFlashcard).length === 0}
        >
          ➕ Add Selected to Flashcards
        </button>
        {saveSuccess && (
          <span style={{ marginLeft: '1rem', color: '#16a34a', fontWeight: 600 }}>
            ✅ Saved!
          </span>
        )}
      </div>
    </div>
  );
}
