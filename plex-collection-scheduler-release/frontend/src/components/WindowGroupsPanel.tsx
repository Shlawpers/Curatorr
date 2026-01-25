import { useState } from 'react';
import { Plus, Calendar, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { format, parseISO, isWithinInterval } from 'date-fns';
import type { WindowGroup, EditMode } from '../types';

interface Props {
  windowGroups: WindowGroup[];
  selectedGroupId: string | null;
  editMode: EditMode;
  onSelectGroup: (groupId: string | null) => void;
  onCreateGroup: (group: Omit<WindowGroup, 'id'>) => Promise<string>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  libraryId: string;
  previewTime: Date;
}

export function WindowGroupsPanel({
  windowGroups,
  selectedGroupId,
  editMode,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  libraryId,
  previewTime,
}: Props) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupStart, setNewGroupStart] = useState('');
  const [newGroupEnd, setNewGroupEnd] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newGroupName || !newGroupStart || !newGroupEnd) return;

    setCreating(true);
    try {
      const groupId = await onCreateGroup({
        library_section_id: libraryId,
        name: newGroupName,
        start_at: new Date(newGroupStart).toISOString(),
        end_at: new Date(newGroupEnd).toISOString(),
        recurrence_rule: null,
        priority: 50,
        color: null,
      });

      setNewGroupName('');
      setNewGroupStart('');
      setNewGroupEnd('');
      setShowCreateForm(false);
      onSelectGroup(groupId);
    } catch (e) {
      console.error('Failed to create group:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this window group? All associated schedule windows will be removed.')) {
      await onDeleteGroup(groupId);
      if (selectedGroupId === groupId) {
        onSelectGroup(null);
      }
    }
  };

  const isGroupActive = (group: WindowGroup) => {
    try {
      const start = parseISO(group.start_at);
      const end = parseISO(group.end_at);
      return isWithinInterval(previewTime, { start, end });
    } catch {
      return false;
    }
  };

  // Sort groups by start date, upcoming first
  const sortedGroups = [...windowGroups].sort((a, b) => {
    const aStart = new Date(a.start_at).getTime();
    const bStart = new Date(b.start_at).getTime();
    return aStart - bStart;
  });

  // Check for overlapping groups
  const hasOverlap = (group: WindowGroup) => {
    const groupStart = new Date(group.start_at).getTime();
    const groupEnd = new Date(group.end_at).getTime();
    return windowGroups.some(other => {
      if (other.id === group.id) return false;
      const otherStart = new Date(other.start_at).getTime();
      const otherEnd = new Date(other.end_at).getTime();
      return (groupStart < otherEnd && groupEnd > otherStart);
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Window Groups
        </h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="p-1.5 hover:bg-plex-border rounded transition-colors"
          title="Create Window Group"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Base Order Button */}
      <button
        onClick={() => onSelectGroup(null)}
        className={`w-full text-left p-3 rounded-lg border mb-2 transition-all ${
          editMode === 'base'
            ? 'bg-plex-gold/10 border-plex-gold'
            : 'bg-plex-card border-plex-border hover:border-plex-gold/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            editMode === 'base' ? 'bg-plex-gold' : 'bg-gray-500'
          }`} />
          <span className="font-medium text-sm">Base Order</span>
        </div>
        <p className="text-xs text-gray-500 mt-1 ml-4">
          Default collection order
        </p>
      </button>

      {/* Divider */}
      <div className="border-t border-plex-border my-3" />

      {/* Window Groups List */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {sortedGroups.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No window groups yet</p>
            <p className="text-xs mt-1">Create one to schedule future orders</p>
          </div>
        ) : (
          sortedGroups.map(group => {
            const isActive = isGroupActive(group);
            const isSelected = selectedGroupId === group.id;
            const overlaps = hasOverlap(group);

            return (
              <button
                key={group.id}
                onClick={() => onSelectGroup(group.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-plex-gold/10 border-plex-gold'
                    : 'bg-plex-card border-plex-border hover:border-plex-gold/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isActive ? 'bg-green-400' : 'bg-gray-500'
                    }`} />
                    <span className="font-medium text-sm truncate">{group.name}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {overlaps && (
                      <span title="Overlaps with another group">
                        <AlertTriangle className="w-3 h-3 text-yellow-400" />
                      </span>
                    )}
                    <button
                      onClick={(e) => handleDelete(group.id, e)}
                      className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <ChevronRight className={`w-4 h-4 transition-transform ${
                      isSelected ? 'rotate-90' : ''
                    }`} />
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1 ml-4">
                  {format(parseISO(group.start_at), 'MMM d, h:mm a')}
                  {' → '}
                  {format(parseISO(group.end_at), 'MMM d, h:mm a')}
                </div>
                {isActive && (
                  <div className="text-xs text-green-400 mt-1 ml-4">
                    Currently active
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create Window Group</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g., Horror Weekend"
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  value={newGroupStart}
                  onChange={(e) => setNewGroupStart(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">End</label>
                <input
                  type="datetime-local"
                  value={newGroupEnd}
                  onChange={(e) => setNewGroupEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                         hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newGroupName || !newGroupStart || !newGroupEnd}
                className="px-4 py-2 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
