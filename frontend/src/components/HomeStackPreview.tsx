import { useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff, Clock, Sparkles } from 'lucide-react';
import type { SnapshotItem, Collection, CollectionSource } from '../types';

interface Props {
  items: SnapshotItem[];
  collections: Collection[];
  onReorder: (items: SnapshotItem[]) => void;
  previewTime: Date;
  isLive: boolean;
}

interface SortableItemProps {
  item: SnapshotItem;
  collection?: Collection;
  isLive: boolean;
}

function SortableItem({ item, collection, isLive }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.collection_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getSourceBadge = (source: CollectionSource) => {
    switch (source) {
      case 'plex':
        return <span className="badge badge-plex">Plex</span>;
      case 'kometa':
        return <span className="badge badge-kometa">Kometa</span>;
      case 'both':
        return <span className="badge badge-both">Both</span>;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-3 bg-plex-card border border-plex-border rounded-lg
        transition-all duration-200
        ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-plex-gold' : 'hover:bg-plex-dark'}
      `}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="drag-handle p-1 text-gray-400 hover:text-white rounded focus:outline-none focus:ring-2 focus:ring-plex-gold"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Position Number */}
      <span className="w-6 h-6 flex items-center justify-center bg-plex-gold/20 text-plex-gold text-xs font-bold rounded">
        {item.position + 1}
      </span>

      {/* Collection Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{item.title}</span>
          {getSourceBadge(item.source)}
          {item.pin_priority !== null && (
            <span className="text-xs text-gray-400">
              Pin: {item.pin_priority}
            </span>
          )}
        </div>
        {collection?.kometa_file && (
          <div className="text-xs text-gray-500 truncate">
            {collection.kometa_file}
          </div>
        )}
      </div>

      {/* Status Indicator */}
      <div className="flex items-center gap-2">
        {isLive && item.active_window_id ? (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <Eye className="w-3 h-3" />
            Active
          </span>
        ) : item.active_window_id ? (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <Clock className="w-3 h-3" />
            Scheduled
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Sparkles className="w-3 h-3" />
            Manual
          </span>
        )}
      </div>
    </div>
  );
}

export function HomeStackPreview({
  items,
  collections,
  onReorder,
  previewTime,
  isLive,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const collectionMap = useMemo(
    () => new Map(collections.map(c => [c.id, c])),
    [collections]
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(item => item.collection_id === active.id);
      const newIndex = items.findIndex(item => item.collection_id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex).map((item, index) => ({
        ...item,
        position: index,
      }));

      onReorder(newItems);
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Home Stack Preview</h2>
          <p className="text-sm text-gray-400">
            {isLive ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Live View
              </span>
            ) : (
              formatTime(previewTime)
            )}
          </p>
        </div>
        <div className="text-sm text-gray-400">
          {items.length} visible
        </div>
      </div>

      {/* Drag and Drop List */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500">
            <EyeOff className="w-8 h-8 mb-2" />
            <p>No collections visible at this time</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map(item => item.collection_id)}
              strategy={verticalListSortingStrategy}
            >
              {items.map(item => (
                <SortableItem
                  key={item.collection_id}
                  item={item}
                  collection={collectionMap.get(item.collection_id)}
                  isLive={isLive}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer Hint */}
      <div className="mt-4 pt-3 border-t border-plex-border text-xs text-gray-500 text-center">
        Drag to reorder. Changes affect base order.
      </div>
    </div>
  );
}
