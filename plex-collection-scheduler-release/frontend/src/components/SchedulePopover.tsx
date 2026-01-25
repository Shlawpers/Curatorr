import { useState } from 'react';
import { X, Plus, Trash2, Calendar, RotateCcw } from 'lucide-react';
import type { ScheduleWindow, RecurrenceType } from '../types';
import { format } from 'date-fns';

interface Props {
  collectionId: string;
  collectionTitle: string;
  windows: ScheduleWindow[];
  onClose: () => void;
  onCreateWindow: (window: Omit<ScheduleWindow, 'id'>) => Promise<void>;
  onDeleteWindow: (windowId: string) => Promise<void>;
}

export function SchedulePopover({
  collectionId,
  collectionTitle,
  windows,
  onClose,
  onCreateWindow,
  onDeleteWindow,
}: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [newWindow, setNewWindow] = useState({
    start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    recurrence: 'none' as RecurrenceType,
  });

  const handleCreate = async () => {
    await onCreateWindow({
      collection_id: collectionId,
      start_date: newWindow.start_date,
      end_date: newWindow.end_date,
      start_time: null,
      end_time: null,
      recurrence: newWindow.recurrence,
      recurrence_end_date: null,
      pin_priority: null,
      explicit_position: null,
      title: null,
      color: null,
      window_group_id: null,
      zone: 'normal',
    });
    setIsCreating(false);
    setNewWindow({
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
      recurrence: 'none',
    });
  };

  const formatWindowSummary = (window: ScheduleWindow) => {
    const start = new Date(window.start_date);
    const end = new Date(window.end_date);

    if (window.recurrence === 'weekly') {
      const startDay = format(start, 'EEE');
      const endDay = format(end, 'EEE');
      return `${startDay}–${endDay} (weekly)`;
    }

    if (window.recurrence === 'yearly') {
      return `${format(start, 'MMM d')}–${format(end, 'MMM d')} (yearly)`;
    }

    return `${format(start, 'MMM d')}–${format(end, 'MMM d, yyyy')}`;
  };

  const recurrenceOptions: { value: RecurrenceType; label: string }[] = [
    { value: 'none', label: 'One-time' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'yearly', label: 'Yearly' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plex-card border border-plex-border rounded-lg w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plex-border">
          <div>
            <h3 className="font-semibold">Schedule Windows</h3>
            <p className="text-sm text-gray-400 truncate">{collectionTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-plex-border rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Windows List */}
        <div className="p-4 max-h-64 overflow-y-auto">
          {windows.length === 0 && !isCreating ? (
            <div className="text-center py-6 text-gray-500">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No schedule windows</p>
              <p className="text-xs mt-1">Add a window to schedule visibility</p>
            </div>
          ) : (
            <div className="space-y-2">
              {windows.map(window => (
                <div
                  key={window.id}
                  className="flex items-center justify-between p-3 bg-plex-dark rounded-lg border border-plex-border"
                >
                  <div className="flex items-center gap-3">
                    {window.recurrence !== 'none' && (
                      <RotateCcw className="w-4 h-4 text-blue-400" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{formatWindowSummary(window)}</p>
                      {window.recurrence !== 'none' && (
                        <p className="text-xs text-gray-500">Repeats {window.recurrence}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteWindow(window.id)}
                    className="p-1 text-gray-500 hover:text-red-400 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Create Form */}
          {isCreating && (
            <div className="mt-4 p-4 bg-plex-dark rounded-lg border border-plex-gold/50">
              <p className="text-sm font-medium mb-3">New Window</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={newWindow.start_date}
                      onChange={(e) => setNewWindow({ ...newWindow, start_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm bg-plex-card border border-plex-border rounded
                                 focus:outline-none focus:ring-2 focus:ring-plex-gold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">End Date</label>
                    <input
                      type="date"
                      value={newWindow.end_date}
                      onChange={(e) => setNewWindow({ ...newWindow, end_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm bg-plex-card border border-plex-border rounded
                                 focus:outline-none focus:ring-2 focus:ring-plex-gold"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Recurrence</label>
                  <select
                    value={newWindow.recurrence}
                    onChange={(e) => setNewWindow({ ...newWindow, recurrence: e.target.value as RecurrenceType })}
                    className="w-full px-2 py-1.5 text-sm bg-plex-card border border-plex-border rounded
                               focus:outline-none focus:ring-2 focus:ring-plex-gold"
                  >
                    {recurrenceOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsCreating(false)}
                    className="px-3 py-1.5 text-sm bg-plex-card border border-plex-border rounded
                               hover:bg-plex-border transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    className="px-3 py-1.5 text-sm bg-plex-gold text-black rounded
                               hover:bg-plex-orange transition-colors"
                  >
                    Add Window
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-plex-border">
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-plex-dark border border-plex-border rounded-lg
                         hover:border-plex-gold hover:text-plex-gold transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Schedule Window
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
