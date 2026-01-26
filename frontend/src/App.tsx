import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AlertCircle, RefreshCw, ChevronDown, Play, Loader2, Clock, SkipForward, Settings, History, X, PanelLeft, PanelRight, LogOut, Lock } from 'lucide-react';
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
  useSavedLayouts,
  usePromotions,
  useAuth,
} from './hooks/useApi';
import type { Library, Collection, LayoutBlock, PromotionCreate, PromotionUpdate } from './types';

function App() {
  // Core state
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewTime, setPreviewTime] = useState(new Date());

  // Mobile UI state
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);

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

  // Promotions state
  const [selectedPromotionId, setSelectedPromotionId] = useState<string | null>(null);

  // Resizable bottom panel state - smaller on mobile
  const [bottomPanelHeight, setBottomPanelHeight] = useState(window.innerWidth < 768 ? 120 : 192);
  const isResizingBottom = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Resizable left panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(256); // 256px = w-64
  const isResizingLeft = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Track if we're on desktop for responsive inline styles
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    duplicateLayoutBlock,
    getLayoutBlockItems,
    saveLayoutBlockItems,
  } = useLayoutBlocks(selectedLibrary?.key || null);
  const {
    savedLayouts,
    fetchSavedLayouts,
    saveLayout,
    loadSavedLayout,
    deleteSavedLayout,
  } = useSavedLayouts(selectedLibrary?.key || null);
  const {
    promotions,
    fetchPromotions,
    createPromotion,
    updatePromotion,
    deletePromotion,
    getPromotionItems,
    savePromotionItems,
  } = usePromotions(selectedLibrary?.key || null);

  // Authentication
  const { authStatus, loading: authLoading, checkAuthStatus, login, logout } = useAuth();
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Handle login submit
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    const success = await login(loginPassword);
    if (!success) {
      setLoginError('Invalid password');
    }
    setLoginPassword('');
    setLoginLoading(false);
  };

  // Handle logout
  const handleLogout = async () => {
    await logout();
  };

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
      fetchSavedLayouts();
      fetchPromotions();
    }
  }, [selectedLibrary, fetchCollections, fetchHubOrder, fetchWindowGroups, fetchLayoutBlocks, fetchSavedLayouts, fetchPromotions]);

  // Resizable bottom panel handler
  const handleBottomResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingBottom.current = true;
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = bottomPanelHeight;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingBottom.current) return;
      const deltaY = resizeStartY.current - e.clientY;
      const newHeight = Math.min(Math.max(100, resizeStartHeight.current + deltaY), 500);
      setBottomPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isResizingBottom.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [bottomPanelHeight]);

  // Resizable left panel handler
  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLeft.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingLeft.current) return;
      const deltaX = e.clientX - resizeStartX.current;
      const newWidth = Math.min(Math.max(200, resizeStartWidth.current + deltaX), 400);
      setLeftPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingLeft.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [leftPanelWidth]);

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
      // Show ALL hubs from Plex's manage list so users can control visibility
      const items: HomeStackItem[] = hubOrder.hubs.map((hub, index) => {
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
    setSelectedPromotionId(null);
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
              // No other block has items - fall back to all Plex hubs
              const items: HomeStackItem[] = hubOrder.hubs.map((hub, index) => {
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

  const handleDuplicateBlock = useCallback(async (blockId: string): Promise<void> => {
    await duplicateLayoutBlock(blockId);
  }, [duplicateLayoutBlock]);

  const handleUpdateBlock = useCallback(async (blockId: string, updates: { name?: string; start_at?: string; end_at?: string }): Promise<void> => {
    await updateLayoutBlock(blockId, updates);
  }, [updateLayoutBlock]);

  // Promotion handlers
  const handleSelectPromotion = useCallback(async (promotionId: string | null) => {
    setSelectedPromotionId(promotionId);
    setBlockItemsLoaded(false);

    if (promotionId) {
      // When selecting a promotion, deselect the block
      setSelectedBlockId(null);
      setIsPreviewMode(true);

      // Set preview time to middle of promotion
      const promotion = promotions.find(p => p.id === promotionId);
      if (promotion) {
        const start = new Date(promotion.start_at);
        const end = new Date(promotion.end_at);
        const middle = new Date((start.getTime() + end.getTime()) / 2);
        setPreviewTime(middle);
      }

      // Load promotion items
      try {
        const promotionItems = await getPromotionItems(promotionId);

        if (promotionItems && promotionItems.length > 0) {
          // Convert promotion items to HomeStackItems
          const items: HomeStackItem[] = promotionItems.map((item) => {
            const hub = hubOrder?.hubs.find(h => h.hub_identifier === item.hub_identifier);
            const title = hub?.title || item.hub_identifier;
            return {
              id: item.hub_identifier,
              hubIdentifier: item.hub_identifier,
              title: title,
              position: item.order_index,
              visibleHome: item.visible_home,
              visibleSharedHome: item.visible_shared_home,
              visibleSharedFriends: item.visible_shared_friends,
              isOnHome: item.visible_home,
              hasSchedule: false,
              windowCount: 0,
              source: 'plex' as const,
            };
          });
          setHomeStackItems(items);
          setHasLocalReorder(true);
          setBlockItemsLoaded(true);
        } else {
          // No items in promotion yet - show empty state
          setHomeStackItems([]);
          setHasLocalReorder(true);
          setBlockItemsLoaded(true);
        }
      } catch (e) {
        console.error('Failed to load promotion items:', e);
        setHomeStackItems([]);
        setBlockItemsLoaded(true);
        setHasLocalReorder(true);
      }
    } else {
      setHasLocalReorder(false);
      setBlockItemsLoaded(false);
    }
  }, [promotions, getPromotionItems, hubOrder]);

  const handleCreatePromotion = useCallback(async (promotion: PromotionCreate): Promise<string> => {
    const result = await createPromotion(promotion);
    return result?.id || '';
  }, [createPromotion]);

  const handleUpdatePromotion = useCallback(async (promotionId: string, updates: PromotionUpdate): Promise<void> => {
    await updatePromotion(promotionId, updates);
  }, [updatePromotion]);

  const handleDeletePromotion = useCallback(async (promotionId: string): Promise<void> => {
    await deletePromotion(promotionId);
    if (selectedPromotionId === promotionId) {
      setSelectedPromotionId(null);
    }
  }, [deletePromotion, selectedPromotionId]);

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

  // Helper to save current stack to promotion items
  const saveStackToPromotion = useCallback(async (items: HomeStackItem[], promotionId?: string) => {
    const targetPromotionId = promotionId || selectedPromotionId;
    if (!targetPromotionId) return;
    try {
      const promotionItems = items.map((item, index) => ({
        hub_identifier: item.hubIdentifier || item.id,
        order_index: index,
        visible_home: item.visibleHome,
        visible_shared_home: item.visibleSharedHome,
        visible_shared_friends: item.visibleSharedFriends,
      }));
      await savePromotionItems(targetPromotionId, promotionItems);
      // Refresh promotions to update item count
      fetchPromotions();
    } catch (e) {
      console.error('Failed to save promotion items:', e);
    }
  }, [selectedPromotionId, savePromotionItems, fetchPromotions]);

  const handleReorder = useCallback((items: HomeStackItem[]) => {
    setHomeStackItems(items);
    // Mark that we have local changes that shouldn't be overwritten by API
    setHasLocalReorder(true);

    if (selectedPromotionId) {
      // Save to promotion items when editing a promotion
      saveStackToPromotion(items);
    } else if (selectedBlockId) {
      // Save to block items when editing a block
      saveStackToBlock(items);
    } else if (!isPreviewMode) {
      // Update base order in backend (only in base mode, not preview)
      const ids = items.map(item => item.id);
      updateBaseOrder(ids).catch(console.error);
    }
  }, [isPreviewMode, selectedBlockId, selectedPromotionId, updateBaseOrder, saveStackToBlock, saveStackToPromotion]);

  const handleRemoveFromStack = useCallback((id: string) => {
    setHomeStackItems(prev => {
      const newItems = prev.filter(item => item.id !== id);
      // Save to promotion or block if editing
      if (selectedPromotionId) {
        saveStackToPromotion(newItems);
      } else if (selectedBlockId) {
        saveStackToBlock(newItems);
      }
      return newItems;
    });
    setHasLocalReorder(true);
  }, [selectedBlockId, selectedPromotionId, saveStackToBlock, saveStackToPromotion]);

  const handleToggleVisibility = useCallback((id: string, field: VisibilityField, value: boolean) => {
    setHomeStackItems(prev => {
      const newItems = prev.map(item =>
        item.id === id ? { ...item, [field]: value, isOnHome: field === 'visibleHome' ? value : item.isOnHome } : item
      );
      // Save to promotion or block if editing
      if (selectedPromotionId) {
        saveStackToPromotion(newItems);
      } else if (selectedBlockId) {
        saveStackToBlock(newItems);
      }
      return newItems;
    });
    setHasLocalReorder(true); // Prevent API overwrite
  }, [selectedBlockId, selectedPromotionId, saveStackToBlock, saveStackToPromotion]);

  const handleAddToStack = useCallback((collection: Collection) => {
    // For promotions, use full hub identifier format (custom.collection.{section_id}.{collection_id})
    // For layout blocks, we continue using just the collection ID for backwards compatibility
    const isPromotion = !!selectedPromotionId;
    const hubIdentifier = isPromotion
      ? `custom.collection.${collection.library_section_id}.${collection.id}`
      : collection.id;

    if (homeStackItems.some(i => i.id === collection.id || i.hubIdentifier === hubIdentifier || i.title === collection.title)) return;

    // For promotions, default to full visibility (all three checkboxes on)
    const newItem: HomeStackItem = {
      id: collection.id,
      hubIdentifier: hubIdentifier,
      title: collection.title,
      position: homeStackItems.length,
      visibleHome: true,
      visibleSharedHome: isPromotion ? true : false,
      visibleSharedFriends: isPromotion ? true : false,
      isOnHome: true,
      hasSchedule: collection.windows_count > 0,
      windowCount: collection.windows_count,
      source: collection.source,
    };
    setHomeStackItems(prev => {
      const newItems = [...prev, newItem];
      // Save to promotion or block if editing
      if (selectedPromotionId) {
        saveStackToPromotion(newItems);
      } else if (selectedBlockId) {
        saveStackToBlock(newItems);
      }
      return newItems;
    });
    setHasLocalReorder(true);
  }, [homeStackItems, selectedBlockId, selectedPromotionId, saveStackToBlock, saveStackToPromotion]);

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
      fetchSavedLayouts();
      fetchPromotions();
      if (isPreviewMode) {
        fetchSnapshot(previewTime);
        fetchDiff(previewTime);
      }
    }
  }, [selectedLibrary, isPreviewMode, previewTime, fetchCollections, fetchHubOrder, fetchWindowGroups, fetchLayoutBlocks, fetchSavedLayouts, fetchPromotions, fetchSnapshot, fetchDiff]);

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

  // Show loading while checking auth status
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-plex-darker">
        <Loader2 className="w-8 h-8 text-plex-gold animate-spin" />
      </div>
    );
  }

  // Show login page if auth required but not authenticated
  if (authStatus?.auth_enabled && !authStatus?.authenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-plex-darker">
        <div className="w-full max-w-sm mx-4">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 shadow-lg">
            <div className="flex flex-col items-center mb-6">
              <Lock className="w-12 h-12 text-plex-gold mb-3" />
              <h1 className="text-xl font-bold text-plex-gold">Curatorr</h1>
              <p className="text-sm text-gray-400">Plex Home Hub Manager</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-3 py-2 bg-plex-darker border border-plex-border rounded
                             text-white placeholder-gray-500
                             focus:outline-none focus:ring-2 focus:ring-plex-gold focus:border-transparent"
                  disabled={loginLoading}
                  autoFocus
                />
              </div>

              {loginError && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || !loginPassword}
                className="w-full py-2 px-4 bg-plex-gold text-black font-medium rounded
                           hover:bg-plex-gold/90 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {loginLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-plex-darker">
      {/* Header */}
      <header className="flex items-center justify-between px-2 md:px-4 py-2 md:py-3 bg-plex-dark border-b border-plex-border">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Mobile panel toggle - left */}
          {selectedLibrary && (
            <button
              onClick={() => setShowLeftPanel(!showLeftPanel)}
              className="p-2 hover:bg-plex-border rounded transition-colors md:hidden"
              title="Toggle Blocks Panel"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex flex-col">
            <h1 className="text-base md:text-lg font-bold text-plex-gold leading-tight">Curatorr</h1>
            <span className="text-[10px] text-gray-500 hidden sm:block">Plex Home Hub Manager</span>
          </div>
          {config && (
            <span className={`hidden sm:inline px-2 py-0.5 text-xs rounded ${
              config.apply_mode === 'dry-run'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-green-500/20 text-green-400'
            }`}>
              {config.apply_mode === 'dry-run' ? 'Dry-run' : 'Live'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 md:gap-3">
          {/* Library Selector */}
          <div className="relative">
            <select
              value={selectedLibrary?.key || ''}
              onChange={(e) => {
                const lib = libraries.find(l => l.key === e.target.value);
                if (lib) handleLibraryChange(lib);
              }}
              disabled={librariesLoading}
              className="appearance-none px-2 md:px-3 py-1.5 pr-7 md:pr-8 bg-plex-card border border-plex-border rounded
                         text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-plex-gold cursor-pointer w-[100px] md:min-w-[150px]"
            >
              <option value="">Library</option>
              {libraries
                .filter(lib => lib.type === 'movie' || lib.type === 'show')
                .map(lib => (
                  <option key={lib.key} value={lib.key}>{lib.title}</option>
                ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Current / Preview Toggle */}
          <div className="hidden sm:flex items-center bg-plex-card border border-plex-border rounded overflow-hidden">
            <button
              onClick={() => {
                setIsPreviewMode(false);
                setSelectedWindowGroupId(null);
                setSelectedBlockId(null);
                setSelectedPromotionId(null);
              }}
              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm transition-colors ${
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
              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm transition-colors ${
                isPreviewMode
                  ? 'bg-plex-gold text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Preview
            </button>
          </div>

          {/* Time Controls (only in preview mode) - hidden on mobile */}
          {isPreviewMode && (
            <div className="hidden lg:flex items-center gap-2 bg-plex-card border border-plex-border rounded px-2 py-1">
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
            className="p-1.5 md:p-2 hover:bg-plex-border rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {selectedLibrary && (
            <>
              <button
                onClick={() => setShowRollbackPanel(true)}
                className="hidden sm:block p-2 hover:bg-plex-border rounded transition-colors"
                title="Rollback History"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowSyncSettings(true)}
                className="hidden sm:block p-2 hover:bg-plex-border rounded transition-colors"
                title="Sync Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              {/* Logout button (only shown when auth is enabled) */}
              {authStatus?.auth_enabled && (
                <button
                  onClick={handleLogout}
                  className="hidden sm:block p-2 hover:bg-plex-border rounded transition-colors text-red-400 hover:text-red-300"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
              {/* Mobile panel toggle - right */}
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                className="p-2 hover:bg-plex-border rounded transition-colors md:hidden"
                title="Toggle Info Panel"
              >
                <PanelRight className="w-5 h-5" />
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
            {/* LEFT: Schedules Panel */}
            {/* Mobile: slide-over panel, Desktop: resizable */}
            <div
              className={`
                fixed inset-y-0 left-0 z-40 w-72 bg-plex-dark border-r border-plex-border
                transform transition-transform duration-200 ease-in-out md:relative md:inset-auto md:z-auto md:transform-none md:flex md:flex-row
                ${showLeftPanel ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
              `}
              style={isDesktop ? { width: leftPanelWidth } : undefined}
            >
              {/* Panel content */}
              <div className="flex-1 p-4 overflow-y-auto">
                {/* Mobile close button */}
                <button
                  onClick={() => setShowLeftPanel(false)}
                  className="absolute top-2 right-2 p-2 hover:bg-plex-border rounded md:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
                <LayoutBlocksPanel
                layoutBlocks={layoutBlocks}
                selectedBlockId={selectedBlockId}
                onSelectBlock={(id) => {
                  handleSelectBlock(id);
                  setShowLeftPanel(false); // Close on mobile after selection
                }}
                onCreateBlock={handleCreateBlock}
                onUpdateBlock={handleUpdateBlock}
                onDeleteBlock={handleDeleteBlock}
                onDuplicateBlock={handleDuplicateBlock}
                savedLayouts={savedLayouts}
                onSaveLayout={saveLayout}
                onLoadSavedLayout={async (layoutId, name, startAt, endAt, repeatYearly) => {
                  const result = await loadSavedLayout(layoutId, name, startAt, endAt, repeatYearly);
                  await fetchLayoutBlocks(); // Refresh layout blocks list
                  return result;
                }}
                onDeleteSavedLayout={deleteSavedLayout}
                onRefreshSavedLayouts={fetchSavedLayouts}
                promotions={promotions}
                selectedPromotionId={selectedPromotionId}
                onSelectPromotion={(id) => {
                  handleSelectPromotion(id);
                  setShowLeftPanel(false); // Close on mobile after selection
                }}
                onCreatePromotion={handleCreatePromotion}
                onUpdatePromotion={handleUpdatePromotion}
                onDeletePromotion={handleDeletePromotion}
                libraryId={selectedLibrary.key}
              />
              </div>
              {/* Resize Handle - desktop only */}
              <div
                onMouseDown={handleLeftResizeStart}
                className="hidden md:block w-1 bg-plex-border hover:bg-plex-gold/50 cursor-ew-resize transition-colors flex-shrink-0"
                title="Drag to resize"
              />
            </div>
            {/* Mobile overlay backdrop */}
            {showLeftPanel && (
              <div
                className="fixed inset-0 bg-black/50 z-30 md:hidden"
                onClick={() => setShowLeftPanel(false)}
              />
            )}

            {/* CENTER: Home Stack + Available Collections */}
            <div className="flex-1 flex flex-col p-2 md:p-4 overflow-hidden">
              {/* Home Stack */}
              <div className="flex-1 bg-plex-dark border border-plex-border rounded-xl p-4 overflow-hidden">
                <HomeStack
                  items={homeStackItems}
                  onReorder={handleReorder}
                  onToggleVisibility={handleToggleVisibility}
                  onRemove={handleRemoveFromStack}
                  isPreviewMode={isPreviewMode}
                  isReadOnly={isPreviewMode && !selectedBlockId && !selectedPromotionId}
                  editingPromotion={selectedPromotionId !== null}
                />
              </div>

              {/* Available Collections - Resizable */}
              <div
                className="mt-4 flex-shrink-0 bg-plex-dark border border-plex-border rounded-xl overflow-hidden flex flex-col"
                style={{ height: bottomPanelHeight }}
              >
                {/* Resize Handle */}
                <div
                  onMouseDown={handleBottomResizeStart}
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
            {/* Mobile: slide-over panel */}
            <div className={`
              fixed inset-y-0 right-0 z-40 w-72 bg-plex-dark border-l border-plex-border p-4 overflow-y-auto
              transform transition-transform duration-200 ease-in-out md:relative md:inset-auto md:z-auto md:transform-none
              ${showRightPanel ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
            `}>
              {/* Mobile close button */}
              <button
                onClick={() => setShowRightPanel(false)}
                className="absolute top-2 left-2 p-2 hover:bg-plex-border rounded md:hidden"
              >
                <X className="w-5 h-5" />
              </button>
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

              {/* Schedule Info */}
              {selectedBlockId && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Editing Schedule
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
            {/* Mobile overlay backdrop for right panel */}
            {showRightPanel && (
              <div
                className="fixed inset-0 bg-black/50 z-30 md:hidden"
                onClick={() => setShowRightPanel(false)}
              />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {selectedLibrary && (
        <footer className="flex items-center justify-between px-2 md:px-4 py-2 bg-plex-dark border-t border-plex-border text-xs md:text-sm">
          <div className="flex items-center gap-2 md:gap-4">
            {/* Show diff vs current Plex state */}
            {(() => {
              const changesVsPlex = diff?.total_changes ?? 0;
              if (changesVsPlex > 0) {
                return (
                  <span className="text-yellow-400">
                    {changesVsPlex} change{changesVsPlex !== 1 ? 's' : ''}
                  </span>
                );
              }
              return <span className="text-green-400">In sync</span>;
            })()}

            {applyResult && (
              <span className={`hidden sm:inline ${applyResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {applyResult.success ? 'Applied' : 'Failed'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {config?.apply_mode === 'dry-run' && (
              <span className="hidden md:inline text-xs text-gray-500">
                Dry-run mode
              </span>
            )}

            <button
              onClick={handleApply}
              disabled={applyLoading || (diff?.total_changes ?? 0) === 0 || config?.apply_mode === 'dry-run'}
              className="flex items-center gap-1 md:gap-2 px-3 md:px-4 py-1.5 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm"
            >
              {applyLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Apply</span>
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
