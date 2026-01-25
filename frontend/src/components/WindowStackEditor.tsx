import { useCallback } from 'react';
import { Pin, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import type { Collection, VisibilityZone, EditMode, SnapshotItem, HiddenSnapshotItem } from '../types';

interface StackItem {
  id: string;
  title: string;
  zone: VisibilityZone;
  position: number;
  source: 'plex' | 'kometa' | 'both';
  isFromWindow: boolean;
  pinPriority?: number;
}

interface Props {
  editMode: EditMode;
  collections: Collection[];
  snapshotItems: SnapshotItem[];
  hiddenItems: HiddenSnapshotItem[];
  windowGroupName: string | null;
  onBaseOrderChange: (ids: string[]) => void;
  onWindowZoneChange: (collectionId: string, zone: VisibilityZone, position?: number) => void;
}

// Single item row with zone controls
function StackItemRow({
  item,
  editMode,
  onMoveUp,
  onMoveDown,
  onChangeZone,
  canMoveUp,
  canMoveDown,
}: {
  item: StackItem;
  editMode: EditMode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeZone: (zone: VisibilityZone) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-plex-card border border-plex-border rounded group hover:border-plex-gold/50 transition-colors">
      {/* Reorder buttons */}
      <div className="flex flex-col">
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="p-0.5 text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move up"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="p-0.5 text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move down"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Position indicator */}
      <span className="w-6 h-6 flex items-center justify-center bg-plex-dark text-xs text-gray-400 rounded">
        {item.position + 1}
      </span>

      {/* Title */}
      <span className="flex-1 text-sm truncate">{item.title}</span>

      {/* Source badge */}
      {item.source === 'kometa' && (
        <span title="Kometa collection" className="px-1.5 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
          K
        </span>
      )}

      {/* Window indicator */}
      {item.isFromWindow && (
        <span className="px-1.5 py-0.5 text-xs bg-plex-gold/20 text-plex-gold rounded">
          W
        </span>
      )}

      {/* Zone controls - only in window mode */}
      {editMode === 'window' && (
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => onChangeZone('pinned')}
            className={`p-1.5 rounded transition-colors ${
              item.zone === 'pinned'
                ? 'bg-green-500/20 text-green-400'
                : 'text-gray-500 hover:text-green-400 hover:bg-green-500/10'
            }`}
            title="Pin to top"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onChangeZone('normal')}
            className={`p-1.5 rounded transition-colors ${
              item.zone === 'normal'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-gray-500 hover:text-blue-400 hover:bg-blue-500/10'
            }`}
            title="Normal visibility"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onChangeZone('hidden')}
            className={`p-1.5 rounded transition-colors ${
              item.zone === 'hidden'
                ? 'bg-red-500/20 text-red-400'
                : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'
            }`}
            title="Hide during this window"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// Zone section header
function ZoneHeader({
  title,
  icon: Icon,
  count,
  colorClass,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  colorClass: string;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg ${colorClass}`}>
      <Icon className="w-4 h-4" />
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs opacity-70">({count})</span>
    </div>
  );
}

export function WindowStackEditor({
  editMode,
  collections,
  snapshotItems,
  hiddenItems,
  windowGroupName,
  onBaseOrderChange,
  onWindowZoneChange,
}: Props) {
  // Build items based on edit mode
  const buildItems = useCallback((): { pinned: StackItem[]; normal: StackItem[]; hidden: StackItem[] } => {
    if (editMode === 'base') {
      // In base mode, show all collections in normal zone
      const items: StackItem[] = collections.map((c, idx) => ({
        id: c.id,
        title: c.title,
        zone: 'normal' as VisibilityZone,
        position: idx,
        source: c.source,
        isFromWindow: false,
      }));
      return { pinned: [], normal: items, hidden: [] };
    }

    // In window mode, organize by zone from snapshot
    const pinned: StackItem[] = [];
    const normal: StackItem[] = [];
    const hidden: StackItem[] = [];

    // Add visible items from snapshot
    for (const item of snapshotItems) {
      const stackItem: StackItem = {
        id: item.collection_id,
        title: item.title,
        zone: item.zone || 'normal',
        position: item.position,
        source: item.source,
        isFromWindow: !!item.active_window_id,
        pinPriority: item.pin_priority ?? undefined,
      };

      if (item.zone === 'pinned') {
        pinned.push(stackItem);
      } else {
        normal.push(stackItem);
      }
    }

    // Add hidden items
    for (const item of hiddenItems) {
      hidden.push({
        id: item.collection_id,
        title: item.title,
        zone: 'hidden',
        position: hidden.length,
        source: 'plex',
        isFromWindow: !!item.hidden_by_window_id,
      });
    }

    // Sort pinned by pin_priority
    pinned.sort((a, b) => (a.pinPriority ?? 999) - (b.pinPriority ?? 999));

    // Re-assign positions
    pinned.forEach((item, i) => item.position = i);
    normal.forEach((item, i) => item.position = i);
    hidden.forEach((item, i) => item.position = i);

    return { pinned, normal, hidden };
  }, [editMode, collections, snapshotItems, hiddenItems]);

  const { pinned, normal, hidden } = buildItems();

  // Move item up within its zone
  const handleMoveUp = useCallback((item: StackItem, zone: 'pinned' | 'normal' | 'hidden') => {
    if (editMode === 'base') {
      const idx = normal.findIndex(i => i.id === item.id);
      if (idx > 0) {
        const newOrder = [...normal];
        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
        onBaseOrderChange(newOrder.map(i => i.id));
      }
    } else {
      // In window mode, update position
      if (item.position > 0) {
        onWindowZoneChange(item.id, zone, item.position - 1);
      }
    }
  }, [editMode, normal, onBaseOrderChange, onWindowZoneChange]);

  // Move item down within its zone
  const handleMoveDown = useCallback((item: StackItem, zone: 'pinned' | 'normal' | 'hidden', zoneItems: StackItem[]) => {
    if (editMode === 'base') {
      const idx = normal.findIndex(i => i.id === item.id);
      if (idx < normal.length - 1) {
        const newOrder = [...normal];
        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
        onBaseOrderChange(newOrder.map(i => i.id));
      }
    } else {
      // In window mode, update position
      if (item.position < zoneItems.length - 1) {
        onWindowZoneChange(item.id, zone, item.position + 1);
      }
    }
  }, [editMode, normal, onBaseOrderChange, onWindowZoneChange]);

  // Change zone for an item
  const handleChangeZone = useCallback((item: StackItem, newZone: VisibilityZone) => {
    if (editMode === 'window') {
      onWindowZoneChange(item.id, newZone, 0);
    }
  }, [editMode, onWindowZoneChange]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">
            {editMode === 'base' ? 'Base Order Editor' : 'Window Stack Editor'}
          </h2>
          <p className="text-sm text-gray-400">
            {editMode === 'base'
              ? 'Use arrows to reorder. This is the default order.'
              : `Editing: ${windowGroupName || 'Unknown Group'}`
            }
          </p>
        </div>
        <div className={`px-2 py-1 text-xs rounded ${
          editMode === 'base'
            ? 'bg-blue-500/20 text-blue-400'
            : 'bg-plex-gold/20 text-plex-gold'
        }`}>
          {editMode === 'base' ? 'Base Mode' : 'Window Mode'}
        </div>
      </div>

      {/* Instructions for window mode */}
      {editMode === 'window' && (
        <div className="mb-4 p-3 bg-plex-gold/10 border border-plex-gold/30 rounded-lg text-sm">
          <p className="text-plex-gold font-medium mb-1">Zone Controls:</p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Pin className="w-3 h-3 text-green-400" /> Pin to top
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3 text-blue-400" /> Normal
            </span>
            <span className="flex items-center gap-1">
              <EyeOff className="w-3 h-3 text-red-400" /> Hidden
            </span>
          </div>
        </div>
      )}

      {/* Stack content */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {editMode === 'base' ? (
          // Base mode: single list
          <div className="space-y-1">
            {normal.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No collections in this library</p>
              </div>
            ) : (
              normal.map((item, idx) => (
                <StackItemRow
                  key={item.id}
                  item={item}
                  editMode={editMode}
                  onMoveUp={() => handleMoveUp(item, 'normal')}
                  onMoveDown={() => handleMoveDown(item, 'normal', normal)}
                  onChangeZone={(zone) => handleChangeZone(item, zone)}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < normal.length - 1}
                />
              ))
            )}
          </div>
        ) : (
          // Window mode: three zones
          <>
            {/* Pinned Zone */}
            <div className="border border-green-500/30 rounded-lg overflow-hidden">
              <ZoneHeader
                title="Pinned (Top)"
                icon={Pin}
                count={pinned.length}
                colorClass="bg-green-500/10 text-green-400"
              />
              <div className="p-2 space-y-1 min-h-[60px]">
                {pinned.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    Click <Pin className="w-3 h-3 inline" /> on items below to pin
                  </div>
                ) : (
                  pinned.map((item, idx) => (
                    <StackItemRow
                      key={item.id}
                      item={item}
                      editMode={editMode}
                      onMoveUp={() => handleMoveUp(item, 'pinned')}
                      onMoveDown={() => handleMoveDown(item, 'pinned', pinned)}
                      onChangeZone={(zone) => handleChangeZone(item, zone)}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < pinned.length - 1}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Normal Zone */}
            <div className="border border-blue-500/30 rounded-lg overflow-hidden">
              <ZoneHeader
                title="Normal"
                icon={Eye}
                count={normal.length}
                colorClass="bg-blue-500/10 text-blue-400"
              />
              <div className="p-2 space-y-1 min-h-[60px]">
                {normal.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No items with normal visibility
                  </div>
                ) : (
                  normal.map((item, idx) => (
                    <StackItemRow
                      key={item.id}
                      item={item}
                      editMode={editMode}
                      onMoveUp={() => handleMoveUp(item, 'normal')}
                      onMoveDown={() => handleMoveDown(item, 'normal', normal)}
                      onChangeZone={(zone) => handleChangeZone(item, zone)}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < normal.length - 1}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Hidden Zone */}
            <div className="border border-red-500/30 rounded-lg overflow-hidden">
              <ZoneHeader
                title="Hidden"
                icon={EyeOff}
                count={hidden.length}
                colorClass="bg-red-500/10 text-red-400"
              />
              <div className="p-2 space-y-1 min-h-[60px]">
                {hidden.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    Click <EyeOff className="w-3 h-3 inline" /> on items above to hide
                  </div>
                ) : (
                  hidden.map((item, idx) => (
                    <StackItemRow
                      key={item.id}
                      item={item}
                      editMode={editMode}
                      onMoveUp={() => handleMoveUp(item, 'hidden')}
                      onMoveDown={() => handleMoveDown(item, 'hidden', hidden)}
                      onChangeZone={(zone) => handleChangeZone(item, zone)}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < hidden.length - 1}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="mt-4 pt-3 border-t border-plex-border text-xs text-gray-500 text-center">
        {editMode === 'base'
          ? 'Changes to base order affect all times without active windows'
          : 'Changes only affect this window group\'s time range'
        }
      </div>
    </div>
  );
}
