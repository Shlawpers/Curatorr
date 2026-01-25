import { useMemo, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventClickArg, DateSelectArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import type { Collection, ScheduleWindow } from '../types';
import { X, Plus } from 'lucide-react';

interface Props {
  collections: Collection[];
  windows: ScheduleWindow[];
  onCreateWindow: (window: Omit<ScheduleWindow, 'id'>) => Promise<void>;
  onUpdateWindow: (windowId: string, updates: Partial<ScheduleWindow>) => Promise<void>;
  onDeleteWindow: (windowId: string) => Promise<void>;
  selectedCollectionId: string | null;
  onSelectCollection: (id: string | null) => void;
  onDateClick: (date: Date) => void;
}

// Color palette for collections
const COLORS = [
  '#e5a00d', // Plex gold
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

function getCollectionColor(index: number): string {
  return COLORS[index % COLORS.length];
}

export function ScheduleCalendar({
  collections,
  windows,
  onCreateWindow,
  onUpdateWindow,
  onDeleteWindow: _onDeleteWindow,
  selectedCollectionId,
  onSelectCollection,
  onDateClick,
}: Props) {
  // Note: _onDeleteWindow reserved for future context menu implementation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalData, setCreateModalData] = useState<{
    start: Date;
    end: Date;
    collectionId: string;
  } | null>(null);

  // Build color map for collections
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    collections.forEach((c, i) => {
      map.set(c.id, getCollectionColor(i));
    });
    return map;
  }, [collections]);

  // Convert windows to FullCalendar events
  const events: EventInput[] = useMemo(() => {
    return windows.map(window => {
      const collection = collections.find(c => c.id === window.collection_id);
      const color = colorMap.get(window.collection_id) || COLORS[0];

      return {
        id: window.id,
        title: collection?.title || 'Unknown Collection',
        start: window.start_time
          ? `${window.start_date}T${window.start_time}`
          : window.start_date,
        end: window.end_time
          ? `${window.end_date}T${window.end_time}`
          : window.end_date,
        allDay: !window.start_time && !window.end_time,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          windowId: window.id,
          collectionId: window.collection_id,
          pinPriority: window.pin_priority,
          recurrence: window.recurrence,
        },
      };
    });
  }, [windows, collections, colorMap]);

  const handleDateSelect = useCallback((selectInfo: DateSelectArg) => {
    if (!selectedCollectionId) {
      // If no collection selected, just navigate to the date
      onDateClick(selectInfo.start);
      return;
    }

    // Open create modal with selected range
    setCreateModalData({
      start: selectInfo.start,
      end: selectInfo.end,
      collectionId: selectedCollectionId,
    });
    setShowCreateModal(true);
  }, [selectedCollectionId, onDateClick]);

  const handleEventClick = useCallback((clickInfo: EventClickArg) => {
    const { collectionId } = clickInfo.event.extendedProps;
    onSelectCollection(collectionId);
  }, [onSelectCollection]);

  const handleEventDrop = useCallback(async (dropInfo: EventDropArg) => {
    const { windowId } = dropInfo.event.extendedProps;
    const start = dropInfo.event.start;
    const end = dropInfo.event.end || dropInfo.event.start;

    if (!start || !end) return;

    try {
      await onUpdateWindow(windowId, {
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
        start_time: dropInfo.event.allDay ? null : start.toTimeString().slice(0, 5),
        end_time: dropInfo.event.allDay ? null : end.toTimeString().slice(0, 5),
      });
    } catch (e) {
      dropInfo.revert();
    }
  }, [onUpdateWindow]);

  const handleEventResize = useCallback(async (resizeInfo: EventResizeDoneArg) => {
    const { windowId } = resizeInfo.event.extendedProps;
    const start = resizeInfo.event.start;
    const end = resizeInfo.event.end || resizeInfo.event.start;

    if (!start || !end) return;

    try {
      await onUpdateWindow(windowId, {
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
        start_time: resizeInfo.event.allDay ? null : start.toTimeString().slice(0, 5),
        end_time: resizeInfo.event.allDay ? null : end.toTimeString().slice(0, 5),
      });
    } catch (e) {
      resizeInfo.revert();
    }
  }, [onUpdateWindow]);

  const handleCreateSubmit = async () => {
    if (!createModalData) return;

    try {
      await onCreateWindow({
        collection_id: createModalData.collectionId,
        start_date: createModalData.start.toISOString().split('T')[0],
        end_date: createModalData.end.toISOString().split('T')[0],
        start_time: null,
        end_time: null,
        recurrence: 'none',
        recurrence_end_date: null,
        pin_priority: null,
        explicit_position: null,
        title: null,
        color: null,
        window_group_id: null,
        zone: 'normal',
      });
      setShowCreateModal(false);
      setCreateModalData(null);
    } catch (e) {
      console.error('Failed to create window:', e);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Collection Filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => onSelectCollection(null)}
          className={`px-2 py-1 text-xs rounded border transition-colors ${
            selectedCollectionId === null
              ? 'bg-plex-gold text-black border-plex-gold'
              : 'bg-plex-dark border-plex-border hover:border-plex-gold'
          }`}
        >
          All
        </button>
        {collections.slice(0, 10).map((collection, index) => (
          <button
            key={collection.id}
            onClick={() => onSelectCollection(collection.id)}
            className={`px-2 py-1 text-xs rounded border transition-colors flex items-center gap-1 ${
              selectedCollectionId === collection.id
                ? 'ring-2 ring-plex-gold'
                : 'hover:opacity-80'
            }`}
            style={{
              backgroundColor: `${getCollectionColor(index)}20`,
              borderColor: getCollectionColor(index),
              color: getCollectionColor(index),
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getCollectionColor(index) }}
            />
            {collection.title.length > 15
              ? collection.title.slice(0, 15) + '...'
              : collection.title}
          </button>
        ))}
        {collections.length > 10 && (
          <span className="px-2 py-1 text-xs text-gray-500">
            +{collections.length - 10} more
          </span>
        )}
      </div>

      {/* Calendar */}
      <div className="flex-1 overflow-hidden">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          events={
            selectedCollectionId
              ? events.filter(e => e.extendedProps?.collectionId === selectedCollectionId)
              : events
          }
          editable={true}
          selectable={true}
          selectMirror={true}
          dayMaxEvents={3}
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          height="100%"
          eventDisplay="block"
          eventTimeFormat={{
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short',
          }}
        />
      </div>

      {/* Create Window Modal */}
      {showCreateModal && createModalData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Create Schedule Window</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateModalData(null);
                }}
                className="p-1 hover:bg-plex-border rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Collection</label>
                <select
                  value={createModalData.collectionId}
                  onChange={(e) =>
                    setCreateModalData({ ...createModalData, collectionId: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                             focus:outline-none focus:ring-2 focus:ring-plex-gold"
                >
                  {collections.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={createModalData.start.toISOString().split('T')[0]}
                    onChange={(e) =>
                      setCreateModalData({
                        ...createModalData,
                        start: new Date(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                               focus:outline-none focus:ring-2 focus:ring-plex-gold"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">End Date</label>
                  <input
                    type="date"
                    value={createModalData.end.toISOString().split('T')[0]}
                    onChange={(e) =>
                      setCreateModalData({
                        ...createModalData,
                        end: new Date(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                               focus:outline-none focus:ring-2 focus:ring-plex-gold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateModalData(null);
                  }}
                  className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                             hover:bg-plex-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSubmit}
                  className="px-4 py-2 bg-plex-gold text-black rounded
                             hover:bg-plex-orange transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
