import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AlertCircle, RefreshCw, ChevronDown, Play, Loader2, Clock, SkipForward, Settings, History } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { HomeStack, HomeStackItem, VisibilityField } from './components/HomeStack';
import { LayoutBlocksPanel } from './components/LayoutBlocksPanel';
import { AvailableCollections } from './components/AvailableCollections';
import { DiffPanel } from './components/DiffPanel';
import { SyncSettings } from './components/SyncSettings';
import { RollbackPanel } from './components/RollbackPanel';
import { ConflictsPanel } from './components/ConflictsIndicator';
import {
  useConfig,
  useLibraries,
  useCollections,
  useHubOrder,
  useSnapshot,
  useDiff,
  useApply,
  useBaseOrder,
  useWindowGroups,
  useLayoutBlocks,
} from './hooks/useApi';
import type { Library, Collection, LayoutBlock } from './types';

function App() {
  // Core state
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewTime, setPreviewTime] = useState(new Date());

  // Home stack state (local working copy)
  const [homeStackItems, setHomeStackItems] = useState<HomeStackItem[]>([]);
  // Track whether we have local changes that should NOT be overwritten by API data
  const [hasLocalReorder, setHasLocalReorder] = useState(false);

  // Legacy window group state - kept for backward compatibility with right panel display
  const [selectedWindowGroupId, setSelectedWindowGroupId] = useState<string | null>(null);

  // Layout blocks state
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  // Track whether we've loaded block items (to know if empty stack means "no items" vs "not loaded yet")
  const [blockItemsLoaded, setBlockItemsLoaded] = useState(false);

  // Resizable bottom panel state
  const [bottomPanelHeight, setBottomPanelHeight] = useState(192); // 12rem = 192px (h-48)
  const isResizing = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Sync settings modal
  const [showSyncSettings, setShowSyncSettings] = useState(false);

  // Rollback panel modal
  const [showRollbackPanel, setShowRollbackPanel] = useState(false);

  // API hooks
  const { config, fetchConfig } = useConfig();
  const { libraries, loading: librariesLoading, fetchLibraries } = useLibraries();
  const { collections, loading: collectionsLoading, fetchCollections } = useCollections(
    selectedLibrary?.key || null
  );
  const { hubOrder, loading: hubsLoading, fetchHubOrder } = useHubOrder(
    selectedLibrary?.key || null
  );
  const { snapshot, fetchSnapshot } = useSnapshot(selectedLibrary?.key || null);
  const { diff, loading: diffLoading, fetchDiff } = useDiff(selectedLibrary?.key || null);
  const { result: applyResult, loading: applyLoading, apply } = useApply(
    selectedLibrary?.key || null
  );
  const { updateBaseOrder } = useBaseOrder(selectedLibrary?.key || null);
  const {
    windowGroups,
    fetchWindowGroups,
  } = useWindowGroups(selectedLibrary?.key || null);
  const {
    layoutBlocks,
    fetchLayoutBlocks,
    createLayoutBlock,
    updateLayoutBlock,
    deleteLayoutBlock,
    getLayoutBlockItems,
    saveLayoutBlockItems,
  } = useLayoutBlocks(selectedLibrary?.key || null);

  // Initial load
  useEffect(() => {
    fetchConfig();
    fetchLibraries();
  }, [fetchConfig, fetchLibraries]);

  // Load data when library changes
  useEffect(() => {
    if (selectedLibrary) {
      fetchCollections();
      fetchHubOrder();
      fetchWindowGroups();
      fetchLayoutBlocks();
    }
  }, [selectedLibrary, fetchCollections, fetchHubOrder, fetchWindowGroups, fetchLayoutBlocks]);

  // Resizable panel handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = bottomPanelHeight;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const deltaY = resizeStartY.current - e.clientY;
      const newHeight = Math.min(Math.max(100, resizeStartHeight.current + deltaY), 500);
      setBottomPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [bottomPanelHeight]);

  // BUILD HOME STACK FROM PLEX HUBS
  // Only rebuild from API when:
  // 1. We don't have local reorder changes pending, OR
  // 2. We're switching modes (preview <-> current), OR
  // 3. The hubOrder itself changes (new API data)
  //
  // When editing a layout block:
  // - If block has saved items: handleSelectBlock loads them directly (hasLocalReorder=true protects them)
  // - If block has NO saved items: initialize from snapshot as starting point
  useEffect(() => {
    if (!selectedLibrary) return;

    // Editing a block with no saved items - initialize from snapshot
    const editingEmptyBlock = selectedBlockId && blockItemsLoaded && !hasLocalReorder;

    if (isPreviewMode && snapshot && (!selectedBlockId || editingEmptyBlock) && !hasLocalReorder) {
      // Preview mode: show computed snapshot
      // This runs for: (1) preview without block selected, (2) block selected but no items saved yet
      const items: HomeStackItem[] = snapshot.visible_collections.map((item, index) => {
        const collection = collections.find(c => c.id === item.collection_id);
        return {
          id: item.collection_id,
          hubIdentifier: item.collection_id,
          title: item.title,
          position: index,
          visibleHome: true,
          visibleSharedHome: false,
          visibleSharedFriends: false,
          isOnHome: true,
          hasSchedule: !!item.active_window_id,
          scheduleSummary: item.active_window_id ? 'Active' : undefined,
          windowCount: collection?.windows_count || 0,
          source: item.source,
        };
      });
      setHomeStackItems(items);
      setHasLocalReorder(false);
    } else if (!isPreviewMode && hubOrder && !hasLocalReorder) {
      // CURRENT MODE: Use hubOrder.hubs (actual Plex state!)
      // Only rebuild if we don't have pending local reorder changes
      // Filter to ONLY promoted hubs (those currently visible on Home)
      const promotedHubs = hubOrder.hubs.filter(h => h.promoted);
      const items: HomeStackItem[] = promotedHubs.map((hub, index) => {
        // Try to find matching collection for metadata
        const collection = collections.find(c =>
          c.title === hub.title ||
          hub.hub_key.includes(`/collections/${c.id}`)
        );
        // Generate a unique ID: use hub_identifier if available, otherwise fallback to
        // a stable ID based on hub_key or title to prevent duplicate key errors.
        // hub_key contains the collection path (e.g., /library/collections/12345) and is unique.
        const uniqueId = hub.hub_identifier && hub.hub_identifier.trim() !== ''
          ? hub.hub_identifier
          : hub.hub_key || `hub-${hub.title}`;
        return {
          id: uniqueId,
          hubIdentifier: hub.hub_identifier || uniqueId,
          title: hub.title,
          position: index,
          // Correct mapping from Plex API fields to internal fields:
          // visibleSharedFriends = "Library Recommended" = promoted_to_recommended
          // visibleHome = "Home" = promoted_to_own_home
          // visibleSharedHome = "Friends' Home" = promoted_to_shared_home
          visibleSharedFriends: hub.promoted_to_recommended,
          visibleHome: hub.promoted_to_own_home,
          visibleSharedHome: hub.promoted_to_shared_home,
          isOnHome: hub.promoted,
          hasSchedule: (collection?.windows_count || 0) > 0,
          windowCount: collection?.windows_count || 0,
          source: (collection?.source || 'plex') as 'plex' | 'kometa' | 'both',
        };
      });
      setHomeStackItems(items);
    }
  }, [isPreviewMode, snapshot, hubOrder, collections, selectedLibrary, hasLocalReorder, selectedBlockId, blockItemsLoaded]);

  // Fetch preview snapshot when preview time changes
  useEffect(() => {
    if (isPreviewMode && selectedLibrary) {
      fetchSnapshot(previewTime);
      fetchDiff(previewTime);
    }
  }, [isPreviewMode, previewTime, selectedLibrary, fetchSnapshot, fetchDiff]);

  // Handlers
  const handleLibraryChange = (lib: Library) => {
    setSelectedLibrary(lib);
    setHomeStackItems([]);
    setIsPreviewMode(false);
    setSelectedWindowGroupId(null);
    setSelectedBlockId(null);
    setHasLocalReorder(false); // Reset local changes flag on library switch
    setBlockItemsLoaded(false);
  };

  // Helper to find collection by hub identifier or rating key
  const findCollectionByHubId = useCallback((hubId: string) => {
    // hubId can be: "custom.collection.11.146941" or just "146941" or a title
    // Extract the rating key from hub identifier format
    const parts = hubId.split('.');
    const ratingKey = parts.length >= 4 ? parts[parts.length - 1] : hubId;

    // Try to find by rating key first, then by title, then by hub key
    return collections.find(c =>
      c.id === ratingKey ||
      c.id === hubId ||
      c.title === hubId
    );
  }, [collections]);

  // Helper to get title from hub identifier
  const getTitleFromHubId = useCallback((hubId: string) => {
    const collection = findCollectionByHubId(hubId);
    if (collection) return collection.title;

    // Try to find matching hub by identifier
    const hub = hubOrder?.hubs.find(h => h.hub_identifier === hubId);
    if (hub) return hub.title;

    return hubId; // Fallback to the ID itself
  }, [findCollectionByHubId, hubOrder]);

  // Layout block handlers
  const handleSelectBlock = useCallback(async (blockId: string | null) => {
    setSelectedBlockId(blockId);
    setBlockItemsLoaded(false); // Reset on block change

    if (blockId) {
      setIsPreviewMode(true);
      const block = layoutBlocks.find(b => b.id === blockId);
      if (block) {
        const start = new Date(block.start_at);
        const end = new Date(block.end_at);
        const middle = new Date((start.getTime() + end.getTime()) / 2);
        setPreviewTime(middle);

        // Load block items from API
        try {
          const blockItems = await getLayoutBlockItems(blockId);

          if (blockItems && blockItems.length > 0) {
            // Convert block items to HomeStackItems
            const items: HomeStackItem[] = blockItems.map((item) => {
              const collection = findCollectionByHubId(item.collection_id);
              const title = getTitleFromHubId(item.collection_id);
              return {
                id: item.collection_id,
                hubIdentifier: item.collection_id,
                title: title,
                position: item.order_index,
                visibleHome: item.visible_home,
                visibleSharedHome: item.visible_shared_home,
                visibleSharedFriends: item.visible_shared_friends,
                isOnHome: item.visible_home,
                hasSchedule: false,
                windowCount: 0,
                source: collection?.source || 'plex',
              };
            });
            setHomeStackItems(items);
            setHasLocalReorder(true); // Protect from snapshot overwrite
            setBlockItemsLoaded(true);
          } else {
            // No items saved for this block yet
            // Try to inherit from another block that has saved items (preferably most recent)
            let inheritedItems: HomeStackItem[] | null = null;

            // Find other blocks and try to load their items
            const otherBlocks = layoutBlocks
              .filter(b => b.id !== blockId)
              .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

            for (const otherBlock of otherBlocks) {
              try {
                const otherBlockItems = await getLayoutBlockItems(otherBlock.id);
                if (otherBlockItems && otherBlockItems.length > 0) {
                  // Found a block with items - use it as starting point
                  inheritedItems = otherBlockItems.map((item) => {
                    const collection = findCollectionByHubId(item.collection_id);
                    const title = getTitleFromHubId(item.collection_id);
                    return {
                      id: item.collection_id,
                      hubIdentifier: item.collection_id,
                      title: title,
                      position: item.order_index,
                      visibleHome: item.visible_home,
                      visibleSharedHome: item.visible_shared_home,
                      visibleSharedFriends: item.visible_shared_friends,
                      isOnHome: item.visible_home,
                      hasSchedule: false,
                      windowCount: 0,
                      source: collection?.source || 'plex',
                    };
                  });
                  break; // Found items, stop searching
                }
              } catch {
                // Continue to next block
              }
            }

            if (inheritedItems) {
              setHomeStackItems(inheritedItems);
              setHasLocalReorder(true); // Protect inherited items from snapshot overwrite
              setBlockItemsLoaded(true);
              // Persist inherited items to the new block so they're not lost on re-select
              saveStackToBlock(inheritedItems, blockId);
            } else if (hubOrder && hubOrder.hubs.length > 0) {
              // No other block has items - fall back to Plex's promoted hubs
              const promotedHubs = hubOrder.hubs.filter(h => h.promoted);
              const items: HomeStackItem[] = promotedHubs.map((hub, index) => {
                const collection = collections.find(c =>
                  c.title === hub.title ||
                  hub.hub_key.includes(`/collections/${c.id}`)
                );
                const uniqueId = hub.hub_identifier && hub.hub_identifier.trim() !== ''
                  ? hub.hub_identifier
                  : hub.hub_key || `hub-${hub.title}`;
                return {
                  id: uniqueId,
                  hubIdentifier: hub.hub_identifier || uniqueId,
                  title: hub.title,
                  position: index,
                  visibleSharedFriends: hub.promoted_to_recommended,
                  visibleHome: hub.promoted_to_own_home,
                  visibleSharedHome: hub.promoted_to_shared_home,
                  isOnHome: hub.promoted,
                  hasSchedule: (collection?.windows_count || 0) > 0,
                  windowCount: collection?.windows_count || 0,
                  source: (collection?.source || 'plex') as 'plex' | 'kometa' | 'both',
                };
              });
              setHomeStackItems(items);
              // Persist the Plex hub baseline to the new block so they're not lost on re-select
              setHasLocalReorder(true); // Mark as local now that we're saving
              setBlockItemsLoaded(true);
              saveStackToBlock(items, blockId);
            } else {
              // No blocks and no hub data - just mark as loaded
              setHasLocalReorder(false);
              setBlockItemsLoaded(true);
            }
          }
        } catch (e) {
          console.error('Failed to load block items:', e);
          setBlockItemsLoaded(true); // Mark loaded even on error
          setHasLocalReorder(false);
        }
      }
    } else {
      setIsPreviewMode(false);
      setHasLocalReorder(false);
      setBlockItemsLoaded(false);
    }
  }, [layoutBlocks, getLayoutBlockItems, collections, hubOrder, findCollectionByHubId, getTitleFromHubId]);

  const handleCreateBlock = useCallback(async (block: Omit<LayoutBlock, 'id'>): Promise<string> => {
    const result = await createLayoutBlock({
      name: block.name,
      start_at: block.start_at,
      end_at: block.end_at,
    });
    return result?.id || '';
  }, [createLayoutBlock]);

  const handleDeleteBlock = useCallback(async (blockId: string): Promise<void> => {
    await deleteLayoutBlock(blockId);
  }, [deleteLayoutBlock]);

  const handleUpdateBlock = useCallback(async (blockId: string, updates: { name?: string; start_at?: string; end_at?: string }): Promise<void> => {
    await updateLayoutBlock(blockId, updates);
  }, [updateLayoutBlock]);

  // Helper to save current stack to block items
  // Accepts optional blockId for cases where selectedBlockId state hasn't updated yet
  const saveStackToBlock = useCallback(async (items: HomeStackItem[], blockId?: string) => {
    const targetBlockId = blockId || selectedBlockId;
    if (!targetBlockId) return;
    try {
      const blockItems = items.map((item, index) => ({
        collection_id: item.id,
        order_index: index,
        visible_home: item.visibleHome,
        visible_shared_home: item.visibleSharedHome,
        visible_shared_friends: item.visibleSharedFriends,
      }));
      await saveLayoutBlockItems(targetBlockId, blockItems);
      // Refresh diff to update footer after save
      fetchDiff();
    } catch (e) {
      console.error('Failed to save block items:', e);
    }
  }, [selectedBlockId, saveLayoutBlockItems, fetchDiff]);

  const handleReorder = useCallback((items: HomeStackItem[]) => {
    setHomeStackItems(items);
    // Mark that we have local changes that shouldn't be overwritten by API
    setHasLocalReorder(true);

    if (selectedBlockId) {
      // Save to block items when editing a block
      saveStackToBlock(items);
    } else if (!isPreviewMode) {
      // Update base order in backend (only in base mode, not preview)
      const ids = items.map(item => item.id);
      updateBaseOrder(ids).catch(console.error);
    }
  }, [isPreviewMode, selectedBlockId, updateBaseOrder, saveStackToBlock]);

  const handleRemoveFromStack = useCallback((id: string) => {
    setHomeStackItems(prev => {
      const newItems = prev.filter(item => item.id !== id);
      // Save to block if editing a block
      if (selectedBlockId) {
        saveStackToBlock(newItems);
      }
      return newItems;
    });
    setHasLocalReorder(true);
  }, [selectedBlockId, saveStackToBlock]);

  const handleToggleVisibility = useCallback((id: string, field: VisibilityField, value: boolean) => {
    setHomeStackItems(prev => {
      const newItems = prev.map(item =>
        item.id === id ? { ...item, [field]: value, isOnHome: field === 'visibleHome' ? value : item.isOnHome } : item
      );
      // Save to block if editing a block
      if (selectedBlockId) {
        saveStackToBlock(newItems);
      }
      return newItems;
    });
    setHasLocalReorder(true); // Prevent API overwrite
  }, [selectedBlockId, saveStackToBlock]);

  const handleAddToStack = useCallback((collection: Collection) => {
    if (homeStackItems.some(i => i.id === collection.id || i.title === collection.title)) return;

    const newItem: HomeStackItem = {
      id: collection.id,
      hubIdentifier: collection.id,
      title: collection.title,
      position: homeStackItems.length,
      visibleHome: true,
      visibleSharedHome: false,
      visibleSharedFriends: false,
      isOnHome: true,
      hasSchedule: collection.windows_count > 0,
      windowCount: collection.windows_count,
      source: collection.source,
    };
    setHomeStackItems(prev => {
      const newItems = [...prev, newItem];
      // Save to block if editing a block
      if (selectedBlockId) {
        saveStackToBlock(newItems);
      }
      return newItems;
    });
    setHasLocalReorder(true);
  }, [homeStackItems, selectedBlockId, saveStackToBlock]);

  const handleApply = useCallback(async () => {
    await apply();
    // Refresh data from API after apply - fetchDiff will update the footer status
    fetchHubOrder();
    fetchSnapshot();
    fetchDiff();

    // If editing a block, reload block items to keep the UI in sync
    // Don't reset hasLocalReorder - keep showing block items, not hubOrder
    if (selectedBlockId) {
      try {
        const blockItems = await getLayoutBlockItems(selectedBlockId);
        if (blockItems && blockItems.length > 0) {
          const items: HomeStackItem[] = blockItems.map((item) => {
            const collection = findCollectionByHubId(item.collection_id);
            const title = getTitleFromHubId(item.collection_id);
            return {
              id: item.collection_id,
              hubIdentifier: item.collection_id,
              title: title,
              position: item.order_index,
              visibleHome: item.visible_home,
              visibleSharedHome: item.visible_shared_home,
              visibleSharedFriends: item.visible_shared_friends,
              isOnHome: item.visible_home,
              hasSchedule: false,
              windowCount: 0,
              source: collection?.source || 'plex',
            };
          });
          setHomeStackItems(items);
          setHasLocalReorder(true); // Keep showing block items
        }
      } catch (e) {
        console.error('Failed to reload block items after apply:', e);
      }
    } else {
      // No block selected - reset to sync from hubOrder
      setHasLocalReorder(false);
    }
  }, [apply, fetchHubOrder, fetchSnapshot, fetchDiff, selectedBlockId, getLayoutBlockItems, findCollectionByHubId, getTitleFromHubId]);

  const handleRefresh = useCallback(() => {
    if (selectedLibrary) {
      // Reset local changes flag so we re-sync from API
      setHasLocalReorder(false);
      fetchCollections();
      fetchHubOrder();
      fetchWindowGroups();
      fetchLayoutBlocks();
      if (isPreviewMode) {
        fetchSnapshot(previewTime);
        fetchDiff(previewTime);
      }
    }
  }, [selectedLibrary, isPreviewMode, previewTime, fetchCollections, fetchHubOrder, fetchWindowGroups, fetchLayoutBlocks, fetchSnapshot, fetchDiff]);

  const handleJumpToNow = () => {
    setPreviewTime(new Date());
  };

  // Find next window boundary
  const getNextWindowBoundary = useCallback(() => {
    const now = previewTime.getTime();
    const boundaries: { time: Date; label: string }[] = [];

    for (const group of windowGroups) {
      const start = new Date(group.start_at);
      const end = new Date(group.end_at);

      if (start.getTime() > now) {
        boundaries.push({ time: start, label: `${group.name} starts` });
      }
      if (end.getTime() > now) {
        boundaries.push({ time: end, label: `${group.name} ends` });
      }
    }

    boundaries.sort((a, b) => a.time.getTime() - b.time.getTime());
    return boundaries[0] || null;
  }, [previewTime, windowGroups]);

  const nextBoundary = getNextWindowBoundary();

  const handleJumpToNextChange = () => {
    if (nextBoundary) {
      setPreviewTime(nextBoundary.time);
    }
  };

  // Get selected window group
  const selectedWindowGroup = useMemo(() => {
    if (!selectedWindowGroupId) return null;
    return windowGroups.find(g => g.id === selectedWindowGroupId) || null;
  }, [selectedWindowGroupId, windowGroups]);

  // Get titles currently in stack for filtering available collections
  // Use titles instead of IDs because hub identifiers don't match collection IDs
  const homeStackTitles = useMemo(() => new Set(homeStackItems.map(i => i.title)), [homeStackItems]);

  const isLoading = librariesLoading || collectionsLoading || hubsLoading;

  return (
    <div className="h-screen flex flex-col bg-plex-darker">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-plex-dark border-b border-plex-border">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-plex-gold">Plex Home Scheduler</h1>
          {config && (
            <span className={`px-2 py-0.5 text-xs rounded ${
              config.apply_mode === 'dry-run'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-green-500/20 text-green-400'
            }`}>
              {config.apply_mode === 'dry-run' ? 'Dry-run' : 'Live'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Library Selector */}
          <div className="relative">
            <select
              value={selectedLibrary?.key || ''}
              onChange={(e) => {
                const lib = libraries.find(l => l.key === e.target.value);
                if (lib) handleLibraryChange(lib);
              }}
              disabled={librariesLoading}
              className="appearance-none px-3 py-1.5 pr-8 bg-plex-card border border-plex-border rounded
                         text-sm focus:outline-none focus:ring-2 focus:ring-plex-gold cursor-pointer min-w-[150px]"
            >
              <option value="">Select Library</option>
              {libraries
                .filter(lib => lib.type === 'movie' || lib.type === 'show')
                .map(lib => (
                  <option key={lib.key} value={lib.key}>{lib.title}</option>
                ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Current / Preview Toggle */}
          <div className="flex items-center bg-plex-card border border-plex-border rounded overflow-hidden">
            <button
              onClick={() => {
                setIsPreviewMode(false);
                setSelectedWindowGroupId(null);
                setSelectedBlockId(null);
              }}
              className={`px-3 py-1.5 text-sm transition-colors ${
                !isPreviewMode
                  ? 'bg-plex-gold text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Current
            </button>
            <button
              onClick={() => {
                setIsPreviewMode(true);
                fetchSnapshot(previewTime);
              }}
              className={`px-3 py-1.5 text-sm transition-colors ${
                isPreviewMode
                  ? 'bg-plex-gold text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Preview
            </button>
          </div>

          {/* Time Controls (only in preview mode) */}
          {isPreviewMode && (
            <div className="flex items-center gap-2 bg-plex-card border border-plex-border rounded px-2 py-1">
              <button
                onClick={handleJumpToNow}
                className="px-2 py-1 text-xs hover:bg-plex-border rounded transition-colors"
                title="Jump to Now"
              >
                <Clock className="w-3 h-3 inline mr-1" />
                Now
              </button>
              <button
                onClick={handleJumpToNextChange}
                disabled={!nextBoundary}
                className="px-2 py-1 text-xs hover:bg-plex-border rounded transition-colors disabled:opacity-50"
                title={nextBoundary ? `${nextBoundary.label}: ${format(nextBoundary.time, 'MMM d, h:mm a')}` : 'No upcoming window changes'}
              >
                <SkipForward className="w-3 h-3 inline mr-1" />
                Next
              </button>
              <input
                type="datetime-local"
                value={format(previewTime, "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => {
                  const date = new Date(e.target.value);
                  if (!isNaN(date.getTime())) {
                    setPreviewTime(date);
                  }
                }}
                className="px-2 py-1 text-xs bg-transparent border-none focus:outline-none"
              />
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-2 hover:bg-plex-border rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {selectedLibrary && (
            <>
              <button
                onClick={() => setShowRollbackPanel(true)}
                className="p-2 hover:bg-plex-border rounded transition-colors"
                title="Rollback History"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowSyncSettings(true)}
                className="p-2 hover:bg-plex-border rounded transition-colors"
                title="Sync Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Connection Error Banner */}
      {!config && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">
            Unable to connect to backend. Make sure the server is running on port 5100.
          </span>
        </div>
      )}

      {/* Main 3-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {!selectedLibrary ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p className="text-lg">Select a library to get started</p>
              <p className="text-sm mt-1">Choose from Movies or TV Shows above</p>
            </div>
          </div>
        ) : (
          <>
            {/* LEFT: Layout Blocks Panel */}
            <div className="w-64 flex-shrink-0 border-r border-plex-border bg-plex-dark p-4 overflow-hidden">
              <LayoutBlocksPanel
                layoutBlocks={layoutBlocks}
                selectedBlockId={selectedBlockId}
                onSelectBlock={handleSelectBlock}
                onCreateBlock={handleCreateBlock}
                onUpdateBlock={handleUpdateBlock}
                onDeleteBlock={handleDeleteBlock}
                libraryId={selectedLibrary.key}
                previewTime={previewTime}
              />
            </div>

            {/* CENTER: Home Stack + Available Collections */}
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
              {/* Home Stack */}
              <div className="flex-1 bg-plex-dark border border-plex-border rounded-xl p-4 overflow-hidden">
                <HomeStack
                  items={homeStackItems}
                  onReorder={handleReorder}
                  onToggleVisibility={handleToggleVisibility}
                  onRemove={handleRemoveFromStack}
                  isPreviewMode={isPreviewMode}
                  isReadOnly={isPreviewMode && !selectedBlockId}
                />
              </div>

              {/* Available Collections - Resizable */}
              <div
                className="mt-4 flex-shrink-0 bg-plex-dark border border-plex-border rounded-xl overflow-hidden flex flex-col"
                style={{ height: bottomPanelHeight }}
              >
                {/* Resize Handle */}
                <div
                  onMouseDown={handleResizeStart}
                  className="h-1 bg-plex-border hover:bg-plex-gold/50 cursor-ns-resize transition-colors flex-shrink-0"
                  title="Drag to resize"
                />
                {/* Panel Content */}
                <div className="flex-1 p-4 overflow-hidden">
                  <AvailableCollections
                    collections={collections}
                    onAdd={handleAddToStack}
                    homeStackTitles={homeStackTitles}
                  />
                </div>
              </div>
            </div>

            {/* RIGHT: Diff & Apply Panel */}
            <div className="w-72 flex-shrink-0 border-l border-plex-border bg-plex-dark p-4 overflow-y-auto">
              {/* Preview Info */}
              {isPreviewMode && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Preview Time
                  </h3>
                  <div className="bg-plex-card border border-plex-border rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-plex-gold rounded-full animate-pulse" />
                      <span className="text-sm">{format(previewTime, 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Diff Panel */}
              <DiffPanel
                diff={diff}
                loading={diffLoading}
                applyMode={config?.apply_mode || 'dry-run'}
                onApply={handleApply}
                applyResult={applyResult}
                applyLoading={applyLoading}
              />

              {/* Layout Block Info */}
              {selectedBlockId && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Editing Block
                  </h3>
                  {(() => {
                    const block = layoutBlocks.find(b => b.id === selectedBlockId);
                    if (!block) return null;
                    return (
                      <div className="bg-plex-gold/10 border border-plex-gold/30 rounded-lg p-3">
                        <p className="font-medium text-plex-gold">{block.name}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {format(parseISO(block.start_at), 'MMM d, h:mm a')}
                          {' → '}
                          {format(parseISO(block.end_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Schedule Conflicts */}
                  <div className="mt-3">
                    <ConflictsPanel blockId={selectedBlockId} />
                  </div>
                </div>
              )}

              {/* Window Group Info (legacy - kept for backward compatibility) */}
              {selectedWindowGroup && !selectedBlockId && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Editing Window
                  </h3>
                  <div className="bg-plex-gold/10 border border-plex-gold/30 rounded-lg p-3">
                    <p className="font-medium text-plex-gold">{selectedWindowGroup.name}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {format(parseISO(selectedWindowGroup.start_at), 'MMM d, h:mm a')}
                      {' → '}
                      {format(parseISO(selectedWindowGroup.end_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {selectedLibrary && (
        <footer className="flex items-center justify-between px-4 py-2 bg-plex-dark border-t border-plex-border text-sm">
          <div className="flex items-center gap-4">
            {/* Show diff vs current Plex state */}
            {(() => {
              const changesVsPlex = diff?.total_changes ?? 0;
              if (changesVsPlex > 0) {
                return (
                  <span className="text-yellow-400">
                    {changesVsPlex} change{changesVsPlex !== 1 ? 's' : ''} vs Plex
                  </span>
                );
              }
              return <span className="text-green-400">In sync with Plex</span>;
            })()}

            {applyResult && (
              <span className={`${applyResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {applyResult.success ? 'Applied successfully' : 'Apply failed'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {config?.apply_mode === 'dry-run' && (
              <span className="text-xs text-gray-500">
                Dry-run mode: changes won't be applied to Plex
              </span>
            )}

            <button
              onClick={handleApply}
              disabled={applyLoading || (diff?.total_changes ?? 0) === 0 || config?.apply_mode === 'dry-run'}
              className="flex items-center gap-2 px-4 py-1.5 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applyLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Apply Now
            </button>
          </div>
        </footer>
      )}

      {/* Sync Settings Modal */}
      {showSyncSettings && selectedLibrary && (
        <SyncSettings
          library={selectedLibrary}
          onClose={() => setShowSyncSettings(false)}
        />
      )}

      {/* Rollback Panel Modal */}
      {showRollbackPanel && selectedLibrary && (
        <RollbackPanel
          key={`rollback-${Date.now()}`}
          library={selectedLibrary}
          onClose={() => setShowRollbackPanel(false)}
          onRollbackComplete={() => {
            // Refresh data after rollback
            handleRefresh();
          }}
        />
      )}
    </div>
  );
}

export default App;
