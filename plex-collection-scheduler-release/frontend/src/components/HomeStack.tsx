import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  DraggableAttributes,
} from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { GripVertical, Trash2, Home, Users, UserPlus } from 'lucide-react';

export interface HomeStackItem {
  id: string;
  hubIdentifier: string;
  title: string;
  position: number;
  visibleSharedFriends: boolean; // Plex "Library Recommended" = promotedToRecommended
  visibleHome: boolean;          // Plex "Home" = promotedToOwnHome
  visibleSharedHome: boolean;    // Plex "Friends' Home" = promotedToSharedHome
  isOnHome: boolean; // Derived from visibleHome for backwards compatibility
  hasSchedule: boolean;
  scheduleSummary?: string;
  windowCount: number;
  source: 'plex' | 'kometa' | 'both';
}

export type VisibilityField = 'visibleHome' | 'visibleSharedHome' | 'visibleSharedFriends';

interface Props {
  items: HomeStackItem[];
  onReorder: (items: HomeStackItem[]) => void;
  onToggleVisibility: (id: string, field: VisibilityField, value: boolean) => void;
  onRemove: (id: string) => void;
  isPreviewMode: boolean;
  isReadOnly?: boolean; // When true, disables all editing (drag, remove, visibility toggles)
}

interface SortableItemProps {
  item: HomeStackItem;
  onToggleVisibility: (id: string, field: VisibilityField, value: boolean) => void;
  onRemove: (id: string) => void;
  isDragOverlay?: boolean;
  isReadOnly?: boolean;
}

// Visibility checkbox component
function VisibilityCheckbox({
  checked,
  onChange,
  icon: Icon,
  checkedColor,
  tooltip,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  icon: React.ComponentType<{ className?: string }>;
  checkedColor: string;
  tooltip: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      className={`
        w-7 h-7 flex items-center justify-center rounded transition-all
        ${checked
          ? `${checkedColor} text-white shadow-sm`
          : 'bg-gray-600/30 text-gray-500 hover:bg-gray-600/50 hover:text-gray-400'
        }
        ${disabled ? 'cursor-default' : 'cursor-pointer'}
      `}
      title={tooltip}
      disabled={disabled}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// Separate component for rendering the item content (used by both sortable and overlay)
function StackItemContent({
  item,
  onToggleVisibility,
  onRemove,
  isDragging = false,
  isDragOverlay = false,
  isReadOnly = false,
  dragHandleProps,
}: {
  item: HomeStackItem;
  onToggleVisibility: (id: string, field: VisibilityField, value: boolean) => void;
  onRemove: (id: string) => void;
  isDragging?: boolean;
  isDragOverlay?: boolean;
  isReadOnly?: boolean;
  dragHandleProps?: {
    attributes: DraggableAttributes;
    listeners: SyntheticListenerMap | undefined;
  };
}) {
  const anyVisible = item.visibleHome || item.visibleSharedHome || item.visibleSharedFriends;
  return (
    <div
      className={`
        flex items-center gap-3 p-3 bg-plex-card border rounded-lg
        group select-none
        ${isDragging && !isDragOverlay ? 'opacity-40 bg-plex-darker' : ''}
        ${isDragOverlay ? 'shadow-2xl ring-2 ring-plex-gold scale-[1.02] cursor-grabbing' : ''}
        ${anyVisible ? 'border-green-500/50 bg-green-500/5' : 'border-plex-border hover:border-plex-gold/50'}
      `}
    >
      {/* Drag Handle */}
      <button
        {...(!isReadOnly && dragHandleProps?.attributes ? dragHandleProps.attributes : {})}
        {...(!isReadOnly && dragHandleProps?.listeners ? dragHandleProps.listeners : {})}
        className={`drag-handle p-1 rounded focus:outline-none focus:ring-2 focus:ring-plex-gold touch-none ${
          isReadOnly
            ? 'text-gray-600 cursor-not-allowed'
            : isDragOverlay ? 'text-gray-500 cursor-grabbing' : 'text-gray-500 hover:text-white cursor-grab'
        }`}
        disabled={isReadOnly}
      >
        <GripVertical className="w-5 h-5" />
      </button>

      {/* Position Number */}
      <span className={`w-7 h-7 flex items-center justify-center text-sm font-bold rounded flex-shrink-0 ${
        anyVisible ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
      }`}>
        {item.position + 1}
      </span>

      {/* Visibility Checkboxes - Order matches Plex: Library Recommended, Home, Friends' Home */}
      <div className="flex items-center gap-1">
        <VisibilityCheckbox
          checked={item.visibleSharedFriends}
          onChange={() => !isDragOverlay && !isReadOnly && onToggleVisibility(item.id, 'visibleSharedFriends', !item.visibleSharedFriends)}
          icon={UserPlus}
          checkedColor="bg-purple-500"
          tooltip="Library Recommended"
          disabled={isDragOverlay || isReadOnly}
        />
        <VisibilityCheckbox
          checked={item.visibleHome}
          onChange={() => !isDragOverlay && !isReadOnly && onToggleVisibility(item.id, 'visibleHome', !item.visibleHome)}
          icon={Home}
          checkedColor="bg-green-500"
          tooltip="Home"
          disabled={isDragOverlay || isReadOnly}
        />
        <VisibilityCheckbox
          checked={item.visibleSharedHome}
          onChange={() => !isDragOverlay && !isReadOnly && onToggleVisibility(item.id, 'visibleSharedHome', !item.visibleSharedHome)}
          icon={Users}
          checkedColor="bg-blue-500"
          tooltip="Friends' Home"
          disabled={isDragOverlay || isReadOnly}
        />
      </div>

      {/* Title & Source */}
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${!anyVisible ? 'text-gray-400' : ''}`}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.source === 'kometa' && (
            <span className="text-[10px] px-1 py-0.5 bg-purple-500/20 text-purple-400 rounded">Kometa</span>
          )}
          {item.source === 'both' && (
            <span className="text-[10px] px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded">Plex+Kometa</span>
          )}
          {item.hasSchedule && (
            <span className="text-[10px] text-yellow-400">
              {item.scheduleSummary || `${item.windowCount} schedule${item.windowCount !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </div>

      {/* Remove Button - hidden in read-only mode */}
      {!isReadOnly && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!isDragOverlay) onRemove(item.id);
          }}
          className="p-1.5 text-gray-500 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function SortableStackItem({ item, onToggleVisibility, onRemove, isReadOnly = false }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: isReadOnly });

  // Use Translate instead of Transform for more stable sortable behavior
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    // Ensure proper stacking during sort animations
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <StackItemContent
        item={item}
        onToggleVisibility={onToggleVisibility}
        onRemove={onRemove}
        isDragging={isDragging}
        isReadOnly={isReadOnly}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}

export function HomeStack({
  items,
  onReorder,
  onToggleVisibility,
  onRemove,
  isPreviewMode,
  isReadOnly = false,
}: Props) {
  // Track the actively dragged item for the overlay
  const [activeId, setActiveId] = useState<string | null>(null);

  // Configure sensors with activation constraints
  // - distance: 8 pixels prevents accidental drags when clicking buttons
  // - This is critical for reliable drag/drop with interactive elements
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Find the active item for the drag overlay
  const activeItem = useMemo(
    () => activeId ? items.find(item => item.id === activeId) : null,
    [activeId, items]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    // Always clear the active state
    setActiveId(null);

    // Only reorder if we dropped on a different item
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(item => item.id === active.id);
      const newIndex = items.findIndex(item => item.id === over.id);

      // Guard against invalid indices
      if (oldIndex === -1 || newIndex === -1) return;

      const newItems = arrayMove(items, oldIndex, newIndex).map((item, index) => ({
        ...item,
        position: index,
      }));

      onReorder(newItems);
    }
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  const onHomeCount = useMemo(() => items.filter(i => i.visibleHome || i.visibleSharedHome || i.visibleSharedFriends).length, [items]);

  // Memoize the item IDs for SortableContext
  const itemIds = useMemo(() => items.map(item => item.id), [items]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Home Stack
          {isPreviewMode && !isReadOnly && (
            <span className="px-2 py-0.5 text-xs bg-plex-gold/20 text-plex-gold rounded">
              Editing Block
            </span>
          )}
          {isPreviewMode && isReadOnly && (
            <span className="px-2 py-0.5 text-xs bg-gray-500/20 text-gray-400 rounded">
              Preview (Read-only)
            </span>
          )}
          {!isPreviewMode && (
            <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
              Base Template
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-400">{onHomeCount} on Home</span>
          <span className="text-gray-500">{items.length} total</span>
        </div>
      </div>

      {/* Instructions */}
      {!isReadOnly && (
        <div className="mb-3 p-2 bg-plex-darker rounded-lg text-xs text-gray-400">
          <span className="text-green-400">&#9679;</span> = Visible |
          <UserPlus className="w-3 h-3 inline mx-1 text-purple-400" /> Library Rec |
          <Home className="w-3 h-3 inline mx-1 text-green-400" /> Home |
          <Users className="w-3 h-3 inline mx-1 text-blue-400" /> Friends
        </div>
      )}
      {isReadOnly && (
        <div className="mb-3 p-2 bg-gray-700/30 border border-gray-600 rounded-lg text-xs text-gray-400">
          Viewing what Plex will show at this time. Select a Layout Block from the left panel to edit.
        </div>
      )}

      {/* Stack */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500 border-2 border-dashed border-plex-border rounded-lg">
            <p className="text-sm">No collections added</p>
            <p className="text-xs mt-1">Add collections from below</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {items.map(item => (
                <SortableStackItem
                  key={item.id}
                  item={item}
                  onToggleVisibility={onToggleVisibility}
                  onRemove={onRemove}
                  isReadOnly={isReadOnly}
                />
              ))}
            </SortableContext>

            {/* Drag Overlay - Renders the dragged item outside the normal flow */}
            <DragOverlay dropAnimation={{
              duration: 200,
              easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
            }}>
              {activeItem ? (
                <StackItemContent
                  item={activeItem}
                  onToggleVisibility={onToggleVisibility}
                  onRemove={onRemove}
                  isDragOverlay={true}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
