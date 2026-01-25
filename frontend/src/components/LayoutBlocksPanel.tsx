import { useState } from 'react';
import { Plus, Calendar, Trash2, ChevronRight, Layers, Pencil } from 'lucide-react';
import { format, parseISO, isWithinInterval, isBefore } from 'date-fns';
import type { LayoutBlock, LayoutBlockUpdate } from '../types';
import { ConflictBadge } from './ConflictsIndicator';

// Re-export for convenience
export type { LayoutBlock } from '../types';

interface Props {
  layoutBlocks: LayoutBlock[];
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string | null) => void;
  onCreateBlock: (block: Omit<LayoutBlock, 'id'>) => Promise<string>;
  onUpdateBlock: (blockId: string, updates: LayoutBlockUpdate) => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
  libraryId: string;
  previewTime: Date;
}

type BlockStatus = 'active' | 'future' | 'past';

export function LayoutBlocksPanel({
  layoutBlocks,
  selectedBlockId,
  onSelectBlock,
  onCreateBlock,
  onUpdateBlock,
  onDeleteBlock,
  libraryId,
  previewTime,
}: Props) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBlockName, setNewBlockName] = useState('');
  const [newBlockStart, setNewBlockStart] = useState('');
  const [newBlockEnd, setNewBlockEnd] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editingBlock, setEditingBlock] = useState<LayoutBlock | null>(null);
  const [editBlockName, setEditBlockName] = useState('');
  const [editBlockStart, setEditBlockStart] = useState('');
  const [editBlockEnd, setEditBlockEnd] = useState('');
  const [updating, setUpdating] = useState(false);

  const handleCreate = async () => {
    if (!newBlockName || !newBlockStart || !newBlockEnd) return;

    setCreating(true);
    try {
      const blockId = await onCreateBlock({
        library_section_id: libraryId,
        name: newBlockName,
        start_at: new Date(newBlockStart).toISOString(),
        end_at: new Date(newBlockEnd).toISOString(),
      });

      setNewBlockName('');
      setNewBlockStart('');
      setNewBlockEnd('');
      setShowCreateForm(false);
      onSelectBlock(blockId);
    } catch (e) {
      console.error('Failed to create block:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (blockId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this layout block? The base template order will be used during this time period.')) {
      await onDeleteBlock(blockId);
      if (selectedBlockId === blockId) {
        onSelectBlock(null);
      }
    }
  };

  const handleEditClick = (block: LayoutBlock, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBlock(block);
    setEditBlockName(block.name);
    // Convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
    const startDate = parseISO(block.start_at);
    const endDate = parseISO(block.end_at);
    setEditBlockStart(format(startDate, "yyyy-MM-dd'T'HH:mm"));
    setEditBlockEnd(format(endDate, "yyyy-MM-dd'T'HH:mm"));
  };

  const handleUpdate = async () => {
    if (!editingBlock || !editBlockName || !editBlockStart || !editBlockEnd) return;

    setUpdating(true);
    try {
      await onUpdateBlock(editingBlock.id, {
        name: editBlockName,
        start_at: new Date(editBlockStart).toISOString(),
        end_at: new Date(editBlockEnd).toISOString(),
      });
      setEditingBlock(null);
    } catch (e) {
      console.error('Failed to update block:', e);
    } finally {
      setUpdating(false);
    }
  };

  const getBlockStatus = (block: LayoutBlock): BlockStatus => {
    try {
      const start = parseISO(block.start_at);
      const end = parseISO(block.end_at);
      const now = previewTime;

      if (isWithinInterval(now, { start, end })) {
        return 'active';
      }
      if (isBefore(now, start)) {
        return 'future';
      }
      return 'past';
    } catch {
      return 'past';
    }
  };

  // Sort blocks chronologically (upcoming first, then active, then past)
  const sortedBlocks = [...layoutBlocks].sort((a, b) => {
    const aStart = new Date(a.start_at).getTime();
    const bStart = new Date(b.start_at).getTime();
    return aStart - bStart;
  });

  const getStatusIndicator = (status: BlockStatus) => {
    switch (status) {
      case 'active':
        return <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />;
      case 'future':
        return <div className="w-2 h-2 rounded-full bg-blue-400" />;
      case 'past':
        return <div className="w-2 h-2 rounded-full bg-gray-500" />;
    }
  };

  const getStatusText = (status: BlockStatus) => {
    switch (status) {
      case 'active':
        return 'Currently active';
      case 'future':
        return 'Upcoming';
      case 'past':
        return 'Ended';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Layout Blocks
        </h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="p-1.5 hover:bg-plex-border rounded transition-colors"
          title="Create Layout Block"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Base Template (read-only indicator) */}
      <button
        onClick={() => onSelectBlock(null)}
        className={`w-full text-left p-3 rounded-lg border mb-2 transition-all cursor-pointer ${
          selectedBlockId === null
            ? 'bg-plex-gold/10 border-plex-gold'
            : 'bg-plex-card/50 border-plex-border hover:border-plex-gold/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-gray-400" />
          <span className="font-medium text-sm">Base Template</span>
        </div>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          Default order when no block is active
        </p>
      </button>

      {/* Divider */}
      <div className="border-t border-plex-border my-3" />

      {/* Layout Blocks List */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {sortedBlocks.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No layout blocks yet</p>
            <p className="text-xs mt-1">Create one to schedule custom orders</p>
          </div>
        ) : (
          sortedBlocks.map(block => {
            const status = getBlockStatus(block);
            const isSelected = selectedBlockId === block.id;

            return (
              <button
                key={block.id}
                onClick={() => onSelectBlock(block.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-plex-gold/10 border-plex-gold'
                    : status === 'past'
                    ? 'bg-plex-card/50 border-plex-border/50 opacity-60 hover:opacity-80'
                    : 'bg-plex-card border-plex-border hover:border-plex-gold/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {getStatusIndicator(status)}
                    <span className="font-medium text-sm truncate">{block.name}</span>
                    <ConflictBadge blockId={block.id} />
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleEditClick(block, e)}
                      className="p-1 hover:bg-plex-gold/20 rounded text-gray-400 hover:text-plex-gold"
                      title="Edit block"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(block.id, e)}
                      className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                      title="Delete block"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <ChevronRight className={`w-4 h-4 transition-transform ${
                      isSelected ? 'rotate-90' : ''
                    }`} />
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1 ml-4">
                  {format(parseISO(block.start_at), 'MMM d, h:mm a')}
                  {' → '}
                  {format(parseISO(block.end_at), 'MMM d, h:mm a')}
                </div>
                <div className={`text-xs mt-1 ml-4 ${
                  status === 'active' ? 'text-green-400' :
                  status === 'future' ? 'text-blue-400' : 'text-gray-500'
                }`}>
                  {getStatusText(status)}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create Layout Block</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newBlockName}
                  onChange={(e) => setNewBlockName(e.target.value)}
                  placeholder="e.g., Halloween Special"
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  value={newBlockStart}
                  onChange={(e) => setNewBlockStart(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">End</label>
                <input
                  type="datetime-local"
                  value={newBlockEnd}
                  onChange={(e) => setNewBlockEnd(e.target.value)}
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
                disabled={creating || !newBlockName || !newBlockStart || !newBlockEnd}
                className="px-4 py-2 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Form Modal */}
      {editingBlock && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Edit Layout Block</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={editBlockName}
                  onChange={(e) => setEditBlockName(e.target.value)}
                  placeholder="e.g., Halloween Special"
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  value={editBlockStart}
                  onChange={(e) => setEditBlockStart(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">End</label>
                <input
                  type="datetime-local"
                  value={editBlockEnd}
                  onChange={(e) => setEditBlockEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-plex-gold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditingBlock(null)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                         hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={updating || !editBlockName || !editBlockStart || !editBlockEnd}
                className="px-4 py-2 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors disabled:opacity-50"
              >
                {updating ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
