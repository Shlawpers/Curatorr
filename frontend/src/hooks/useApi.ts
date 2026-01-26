import { useState, useCallback } from 'react';
import type {
  Library,
  Collection,
  HubOrderResponse,
  Snapshot,
  Diff,
  ApplyResult,
  Config,
  ScheduleWindow,
  WindowGroup,
  VisibilityZone,
  LayoutBlock,
  LayoutBlockCreate,
  LayoutBlockUpdate,
  LayoutBlockItem,
  LibrarySyncSettings,
  LibrarySyncSettingsUpdate,
  ApplyIfNeededResult,
  RollbackSnapshot,
  RollbackResult,
  BlockConflictsResponse,
  CollectionScheduleInfo,
  Promotion,
  PromotionCreate,
  PromotionUpdate,
  PromotionItem,
} from '../types';

const API_BASE = '/api';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',  // Important for cookies
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// ================== Authentication ==================

export interface AuthStatus {
  auth_enabled: boolean;
  authenticated: boolean;
}

export function useAuth() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuthStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<AuthStatus>('/auth/status');
      setAuthStatus(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to check auth status');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      await fetchApi<{ success: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      // Refresh auth status after login
      await checkAuthStatus();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
      return false;
    }
  }, [checkAuthStatus]);

  const logout = useCallback(async (): Promise<boolean> => {
    try {
      await fetchApi<{ success: boolean }>('/auth/logout', {
        method: 'POST',
      });
      // Refresh auth status after logout
      await checkAuthStatus();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logout failed');
      return false;
    }
  }, [checkAuthStatus]);

  return { authStatus, loading, error, checkAuthStatus, login, logout };
}

// ================== Config ==================

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<Config>('/config');
      setConfig(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch config');
    } finally {
      setLoading(false);
    }
  }, []);

  return { config, loading, error, fetchConfig };
}

export function useLibraries() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLibraries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ libraries: Library[] }>('/libraries');
      setLibraries(data.libraries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch libraries');
    } finally {
      setLoading(false);
    }
  }, []);

  return { libraries, loading, error, fetchLibraries };
}

export function useCollections(sectionId: string | null) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ collections: Collection[] }>(
        `/libraries/${sectionId}/collections`
      );
      setCollections(data.collections);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch collections');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { collections, loading, error, fetchCollections };
}

export function useHubOrder(sectionId: string | null) {
  const [hubOrder, setHubOrder] = useState<HubOrderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHubOrder = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<HubOrderResponse>(`/libraries/${sectionId}/hubs`);
      setHubOrder(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch hub order');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { hubOrder, loading, error, fetchHubOrder };
}

export function useSnapshot(sectionId: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (at?: Date) => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const params = at ? `?at=${at.toISOString()}` : '';
      const data = await fetchApi<Snapshot>(`/libraries/${sectionId}/snapshot${params}`);
      setSnapshot(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch snapshot');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { snapshot, loading, error, fetchSnapshot };
}

export function useDiff(sectionId: string | null) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async (at?: Date) => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const params = at ? `?at=${at.toISOString()}` : '';
      const data = await fetchApi<Diff>(`/libraries/${sectionId}/diff${params}`);
      setDiff(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch diff');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { diff, loading, error, fetchDiff };
}

export function useApply(sectionId: string | null) {
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<ApplyResult>(`/libraries/${sectionId}/apply`, {
        method: 'POST',
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply changes');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { result, loading, error, apply };
}

export function useWindows(collectionId: string | null) {
  const [windows, setWindows] = useState<ScheduleWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWindows = useCallback(async () => {
    if (!collectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ windows: ScheduleWindow[] }>(
        `/collections/${collectionId}/windows`
      );
      setWindows(data.windows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch windows');
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  const createWindow = useCallback(async (window: Omit<ScheduleWindow, 'id'>) => {
    try {
      await fetchApi<{ id: string }>('/windows', {
        method: 'POST',
        body: JSON.stringify(window),
      });
      await fetchWindows();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to create window');
    }
  }, [fetchWindows]);

  const updateWindow = useCallback(async (windowId: string, updates: Partial<ScheduleWindow>) => {
    try {
      await fetchApi(`/windows/${windowId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchWindows();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to update window');
    }
  }, [fetchWindows]);

  const deleteWindow = useCallback(async (windowId: string) => {
    try {
      await fetchApi(`/windows/${windowId}`, {
        method: 'DELETE',
      });
      await fetchWindows();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to delete window');
    }
  }, [fetchWindows]);

  return { windows, loading, error, fetchWindows, createWindow, updateWindow, deleteWindow };
}

export function useBaseOrder(sectionId: string | null) {
  const [order, setOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBaseOrder = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ order: string[] }>(`/libraries/${sectionId}/base-order`);
      setOrder(data.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch base order');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const updateBaseOrder = useCallback(async (collectionIds: string[]) => {
    if (!sectionId) return;
    try {
      await fetchApi(`/libraries/${sectionId}/base-order`, {
        method: 'PUT',
        body: JSON.stringify({ collection_ids: collectionIds }),
      });
      setOrder(collectionIds);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to update base order');
    }
  }, [sectionId]);

  return { order, loading, error, fetchBaseOrder, updateBaseOrder };
}

export function useNextChanges(sectionId: string | null) {
  const [boundaries, setBoundaries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNextChanges = useCallback(async (limit = 5) => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ boundaries: string[]; count: number }>(
        `/libraries/${sectionId}/next-changes?limit=${limit}`
      );
      setBoundaries(data.boundaries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch next changes');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { boundaries, loading, error, fetchNextChanges };
}

export function useWindowGroups(sectionId: string | null) {
  const [windowGroups, setWindowGroups] = useState<WindowGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWindowGroups = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ window_groups: WindowGroup[] }>(
        `/libraries/${sectionId}/window-groups`
      );
      setWindowGroups(data.window_groups);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch window groups');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const createWindowGroup = useCallback(async (group: Omit<WindowGroup, 'id'>) => {
    try {
      const data = await fetchApi<{ id: string }>('/window-groups', {
        method: 'POST',
        body: JSON.stringify(group),
      });
      await fetchWindowGroups();
      return data.id;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to create window group');
    }
  }, [fetchWindowGroups]);

  const updateWindowGroup = useCallback(async (groupId: string, updates: Partial<WindowGroup>) => {
    try {
      await fetchApi(`/window-groups/${groupId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchWindowGroups();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to update window group');
    }
  }, [fetchWindowGroups]);

  const deleteWindowGroup = useCallback(async (groupId: string) => {
    try {
      await fetchApi(`/window-groups/${groupId}`, {
        method: 'DELETE',
      });
      await fetchWindowGroups();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to delete window group');
    }
  }, [fetchWindowGroups]);

  return {
    windowGroups,
    loading,
    error,
    fetchWindowGroups,
    createWindowGroup,
    updateWindowGroup,
    deleteWindowGroup
  };
}

export function useNextChange(sectionId: string | null) {
  const [nextChange, setNextChange] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNextChange = useCallback(async (from?: Date) => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const params = from ? `?from=${from.toISOString()}` : '';
      const data = await fetchApi<{ from: string; next_change: string | null }>(
        `/libraries/${sectionId}/next-change${params}`
      );
      setNextChange(data.next_change);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch next change');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  return { nextChange, loading, error, fetchNextChange };
}

export function useWindowOverrides(groupId: string | null) {
  const [windows, setWindows] = useState<Array<{
    id: string;
    collection_id: string;
    zone: VisibilityZone;
    pin_priority: number | null;
    explicit_position: number | null;
  }>>([]);
  const [loading, setLoading] = useState(false);

  const fetchWindowsForGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const data = await fetchApi<{ windows: typeof windows }>(
        `/window-groups/${groupId}/windows`
      );
      setWindows(data.windows);
    } catch (e) {
      console.error('Failed to fetch windows for group:', e);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const createOrUpdateWindowOverride = useCallback(async (
    collectionId: string,
    zone: VisibilityZone,
    pinPriority?: number,
    explicitPosition?: number
  ) => {
    if (!groupId) return;

    // Check if window already exists for this collection in this group
    const existing = windows.find(w => w.collection_id === collectionId);

    if (existing) {
      // Update existing window
      await fetchApi(`/windows/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          zone,
          pin_priority: pinPriority,
          explicit_position: explicitPosition,
        }),
      });
    } else {
      // Create new window for this group
      // We need the start/end dates from the group, so we'll set placeholder dates
      // The actual date range comes from the window group
      const today = new Date().toISOString().split('T')[0];
      await fetchApi('/windows', {
        method: 'POST',
        body: JSON.stringify({
          collection_id: collectionId,
          window_group_id: groupId,
          zone,
          pin_priority: pinPriority,
          explicit_position: explicitPosition,
          start_date: today,
          end_date: today,
          recurrence: 'none',
        }),
      });
    }

    await fetchWindowsForGroup();
  }, [groupId, windows, fetchWindowsForGroup]);

  const removeWindowOverride = useCallback(async (collectionId: string) => {
    const existing = windows.find(w => w.collection_id === collectionId);
    if (existing) {
      await fetchApi(`/windows/${existing.id}`, {
        method: 'DELETE',
      });
      await fetchWindowsForGroup();
    }
  }, [windows, fetchWindowsForGroup]);

  return {
    windows,
    loading,
    fetchWindowsForGroup,
    createOrUpdateWindowOverride,
    removeWindowOverride,
  };
}

export function useLayoutBlocks(sectionId: string | null) {
  const [layoutBlocks, setLayoutBlocks] = useState<LayoutBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLayoutBlocks = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ layout_blocks: LayoutBlock[] }>(
        `/libraries/${sectionId}/layout-blocks`
      );
      setLayoutBlocks(data.layout_blocks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch layout blocks');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const createLayoutBlock = useCallback(async (block: LayoutBlockCreate) => {
    if (!sectionId) return null;
    try {
      const data = await fetchApi<LayoutBlock>(`/libraries/${sectionId}/layout-blocks`, {
        method: 'POST',
        body: JSON.stringify(block),
      });
      await fetchLayoutBlocks();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to create layout block');
    }
  }, [sectionId, fetchLayoutBlocks]);

  const updateLayoutBlock = useCallback(async (blockId: string, updates: LayoutBlockUpdate) => {
    try {
      const data = await fetchApi<LayoutBlock>(`/layout-blocks/${blockId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchLayoutBlocks();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to update layout block');
    }
  }, [fetchLayoutBlocks]);

  const deleteLayoutBlock = useCallback(async (blockId: string) => {
    try {
      await fetchApi(`/layout-blocks/${blockId}`, {
        method: 'DELETE',
      });
      await fetchLayoutBlocks();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to delete layout block');
    }
  }, [fetchLayoutBlocks]);

  const getLayoutBlockItems = useCallback(async (blockId: string): Promise<LayoutBlockItem[]> => {
    try {
      const data = await fetchApi<{ items: LayoutBlockItem[] }>(`/layout-blocks/${blockId}/items`);
      return data.items;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to fetch layout block items');
    }
  }, []);

  const saveLayoutBlockItems = useCallback(async (blockId: string, items: Omit<LayoutBlockItem, 'id' | 'block_id'>[]) => {
    try {
      await fetchApi(`/layout-blocks/${blockId}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to save layout block items');
    }
  }, []);

  const duplicateLayoutBlock = useCallback(async (blockId: string, name?: string, shiftYears: number = 1) => {
    try {
      const data = await fetchApi<LayoutBlock & { message: string }>(`/layout-blocks/${blockId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name, shift_years: shiftYears }),
      });
      await fetchLayoutBlocks();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to duplicate layout block');
    }
  }, [fetchLayoutBlocks]);

  const exportLayoutBlock = useCallback(async (blockId: string): Promise<object> => {
    try {
      const data = await fetchApi<object>(`/layout-blocks/${blockId}/export`);
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to export layout block');
    }
  }, []);

  const importLayoutBlock = useCallback(async (sectionId: string, importData: object): Promise<{
    success: boolean;
    block_id: string;
    name: string;
    items_imported: number;
    items_skipped: number;
    skipped_collections: string[];
    message: string;
  }> => {
    try {
      const data = await fetchApi<{
        success: boolean;
        block_id: string;
        name: string;
        items_imported: number;
        items_skipped: number;
        skipped_collections: string[];
        message: string;
      }>(`/libraries/${sectionId}/layout-blocks/import`, {
        method: 'POST',
        body: JSON.stringify(importData),
      });
      await fetchLayoutBlocks();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to import layout block');
    }
  }, [fetchLayoutBlocks]);

  return {
    layoutBlocks,
    loading,
    error,
    fetchLayoutBlocks,
    createLayoutBlock,
    updateLayoutBlock,
    deleteLayoutBlock,
    duplicateLayoutBlock,
    exportLayoutBlock,
    importLayoutBlock,
    getLayoutBlockItems,
    saveLayoutBlockItems,
  };
}

// Saved layout type
export interface SavedLayout {
  id: string;
  library_section_id: string;
  name: string;
  description?: string;
  items_count: number;
  created_at: string;
  layout_data?: {
    items: Array<{
      hub_identifier: string;
      collection_title: string;
      order_index: number;
      visible_home: boolean;
      visible_shared_home: boolean;
      visible_shared_friends: boolean;
    }>;
  };
}

export function useSavedLayouts(sectionId: string | null) {
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSavedLayouts = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ saved_layouts: SavedLayout[] }>(
        `/libraries/${sectionId}/saved-layouts`
      );
      setSavedLayouts(data.saved_layouts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch saved layouts');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const saveLayout = useCallback(async (
    blockId: string,
    name: string,
    description?: string
  ): Promise<{ success: boolean; saved_layout: SavedLayout; message: string }> => {
    try {
      const data = await fetchApi<{ success: boolean; saved_layout: SavedLayout; message: string }>(
        `/layout-blocks/${blockId}/save`,
        {
          method: 'POST',
          body: JSON.stringify({ name, description }),
        }
      );
      await fetchSavedLayouts();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to save layout');
    }
  }, [fetchSavedLayouts]);

  const loadSavedLayout = useCallback(async (
    layoutId: string,
    name: string,
    startAt: string,
    endAt: string,
    repeatYearly: boolean = false
  ): Promise<{
    success: boolean;
    block_id: string;
    name: string;
    items_loaded: number;
    items_skipped: number;
    skipped_collections: string[];
    message: string;
  }> => {
    if (!sectionId) throw new Error('No library selected');
    try {
      const data = await fetchApi<{
        success: boolean;
        block_id: string;
        name: string;
        items_loaded: number;
        items_skipped: number;
        skipped_collections: string[];
        message: string;
      }>(
        `/libraries/${sectionId}/saved-layouts/${layoutId}/load`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            start_at: startAt,
            end_at: endAt,
            repeat_yearly: repeatYearly,
          }),
        }
      );
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to load saved layout');
    }
  }, [sectionId]);

  const deleteSavedLayout = useCallback(async (layoutId: string) => {
    try {
      await fetchApi(`/saved-layouts/${layoutId}`, {
        method: 'DELETE',
      });
      await fetchSavedLayouts();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to delete saved layout');
    }
  }, [fetchSavedLayouts]);

  return {
    savedLayouts,
    loading,
    error,
    fetchSavedLayouts,
    saveLayout,
    loadSavedLayout,
    deleteSavedLayout,
  };
}

export function useSyncSettings(sectionId: string | null) {
  const [settings, setSettings] = useState<LibrarySyncSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSyncSettings = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<LibrarySyncSettings>(`/libraries/${sectionId}/sync-settings`);
      setSettings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch sync settings');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const updateSyncSettings = useCallback(async (updates: LibrarySyncSettingsUpdate) => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<LibrarySyncSettings>(`/libraries/${sectionId}/sync-settings`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      setSettings(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update sync settings');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const syncNow = useCallback(async (): Promise<ApplyIfNeededResult> => {
    if (!sectionId) throw new Error('No library selected');
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi<ApplyIfNeededResult>(`/libraries/${sectionId}/sync-now`, {
        method: 'POST',
      });
      // Refresh settings to get updated last_checked_at, last_result, etc.
      await fetchSyncSettings();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sync');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [sectionId, fetchSyncSettings]);

  return {
    settings,
    loading,
    error,
    fetchSyncSettings,
    updateSyncSettings,
    syncNow,
  };
}

export function useRollback(sectionId: string | null) {
  const [snapshots, setSnapshots] = useState<RollbackSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async (limit = 10) => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ snapshots: RollbackSnapshot[] }>(
        `/libraries/${sectionId}/rollback-snapshots?limit=${limit}`
      );
      setSnapshots(data.snapshots);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch snapshots');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const rollbackToSnapshot = useCallback(async (snapshotId: string): Promise<RollbackResult> => {
    if (!sectionId) throw new Error('No library selected');
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi<RollbackResult>(
        `/libraries/${sectionId}/rollback/${snapshotId}`,
        { method: 'POST' }
      );
      // Refresh snapshots after rollback
      await fetchSnapshots();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [sectionId, fetchSnapshots]);

  return {
    snapshots,
    loading,
    error,
    fetchSnapshots,
    rollbackToSnapshot,
  };
}

export function useBlockConflicts(blockId: string | null) {
  const [conflicts, setConflicts] = useState<BlockConflictsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConflicts = useCallback(async (deleteNotScheduled = true) => {
    if (!blockId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<BlockConflictsResponse>(
        `/layout-blocks/${blockId}/conflicts?delete_not_scheduled=${deleteNotScheduled}`
      );
      setConflicts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to check conflicts');
    } finally {
      setLoading(false);
    }
  }, [blockId]);

  const clearConflicts = useCallback(() => {
    setConflicts(null);
    setError(null);
  }, []);

  return {
    conflicts,
    loading,
    error,
    fetchConflicts,
    clearConflicts,
  };
}

export function useCollectionSchedule(collectionName: string | null) {
  const [scheduleInfo, setScheduleInfo] = useState<CollectionScheduleInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(async (at?: Date) => {
    if (!collectionName) return;
    setLoading(true);
    setError(null);
    try {
      const params = at ? `?at=${at.toISOString()}` : '';
      const data = await fetchApi<CollectionScheduleInfo>(
        `/collections/${encodeURIComponent(collectionName)}/schedule${params}`
      );
      setScheduleInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch schedule info');
    } finally {
      setLoading(false);
    }
  }, [collectionName]);

  return {
    scheduleInfo,
    loading,
    error,
    fetchSchedule,
  };
}

export function usePromotions(sectionId: string | null) {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPromotions = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ promotions: Promotion[] }>(
        `/libraries/${sectionId}/promotions`
      );
      setPromotions(data.promotions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch promotions');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  const createPromotion = useCallback(async (promotion: PromotionCreate) => {
    if (!sectionId) return null;
    try {
      const data = await fetchApi<Promotion>(`/libraries/${sectionId}/promotions`, {
        method: 'POST',
        body: JSON.stringify(promotion),
      });
      await fetchPromotions();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to create promotion');
    }
  }, [sectionId, fetchPromotions]);

  const updatePromotion = useCallback(async (promotionId: string, updates: PromotionUpdate) => {
    try {
      const data = await fetchApi<Promotion>(`/promotions/${promotionId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchPromotions();
      return data;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to update promotion');
    }
  }, [fetchPromotions]);

  const deletePromotion = useCallback(async (promotionId: string) => {
    try {
      await fetchApi(`/promotions/${promotionId}`, {
        method: 'DELETE',
      });
      await fetchPromotions();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to delete promotion');
    }
  }, [fetchPromotions]);

  const getPromotionItems = useCallback(async (promotionId: string): Promise<PromotionItem[]> => {
    try {
      const data = await fetchApi<{ items: PromotionItem[] }>(`/promotions/${promotionId}/items`);
      return data.items;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to fetch promotion items');
    }
  }, []);

  const savePromotionItems = useCallback(async (promotionId: string, items: Omit<PromotionItem, 'id' | 'promotion_id'>[]) => {
    try {
      await fetchApi(`/promotions/${promotionId}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Failed to save promotion items');
    }
  }, []);

  return {
    promotions,
    loading,
    error,
    fetchPromotions,
    createPromotion,
    updatePromotion,
    deletePromotion,
    getPromotionItems,
    savePromotionItems,
  };
}
