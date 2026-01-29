// API Types

export interface Library {
  key: string;
  title: string;
  type: string;
}

export type CollectionSource = 'plex' | 'kometa' | 'both';
export type ScheduleStatus = 'active' | 'scheduled' | 'kometa_only' | 'manual' | 'conflict';
export type VisibilityType = 'home' | 'library' | 'hidden';
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type VisibilityZone = 'pinned' | 'normal' | 'hidden';
export type EditMode = 'base' | 'window';

export interface Collection {
  id: string;
  title: string;
  source: CollectionSource;
  library_section_id: string;
  base_order_index: number;
  windows_count: number;
  thumb: string | null;
  child_count: number;
  smart: boolean;
  kometa_file: string | null;
  status: ScheduleStatus;
  default_visible_on_home?: boolean;
}

export interface Hub {
  hub_identifier: string;
  title: string;
  type: string;
  promoted: boolean;
  promoted_to_own_home: boolean;
  promoted_to_shared_home: boolean;
  promoted_to_recommended: boolean;
  hub_key: string;
  context: string;
}

export interface HubOrderResponse {
  library_section_id: string;
  hubs: Hub[];
  order: string[];
  promoted_count: number;
}

export interface WindowGroup {
  id: string;
  library_section_id: string;
  name: string;
  start_at: string;
  end_at: string;
  recurrence_rule: string | null;
  priority: number;
  color: string | null;
}

export interface ScheduleWindow {
  id: string;
  collection_id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  recurrence: RecurrenceType;
  recurrence_end_date: string | null;
  pin_priority: number | null;
  explicit_position: number | null;
  title: string | null;
  color: string | null;
  window_group_id: string | null;
  zone: VisibilityZone;
}

export interface SnapshotItem {
  collection_id: string;
  title: string;
  position: number;
  source: CollectionSource;
  active_window_id: string | null;
  active_window_group_id: string | null;
  pin_priority: number | null;
  zone: VisibilityZone;
}

export interface HiddenSnapshotItem {
  collection_id: string;
  title: string;
  hidden_by_window_id: string | null;
  hidden_by_window_group_id: string | null;
}

export interface Snapshot {
  timestamp: string;
  library_section_id: string;
  visible_collections: SnapshotItem[];
  hidden_collections: HiddenSnapshotItem[];
}

export interface VisibilityChange {
  collection_id: string;
  title: string;
  from: VisibilityType;
  to: VisibilityType;
}

export interface OrderChange {
  collection_id: string;
  title: string;
  from_position: number | null;
  to_position: number;
}

export interface Diff {
  computed_at: string;
  target_time: string;
  library_section_id: string;
  no_active_block: boolean;
  active_block_id: string | null;
  active_block_name: string | null;
  active_promotions: Array<{ id: string; name: string; repeat_yearly: boolean }>;
  visibility_changes: VisibilityChange[];
  order_changes: OrderChange[];
  total_changes: number;
  has_conflicts: boolean;
  conflict_messages: string[];
}

export interface ApplyResult {
  success: boolean;
  timestamp: string;
  library_section_id: string;
  visibility_applied: number;
  visibility_failed: number;
  order_applied: boolean;
  order_verified: boolean;
  reorder_attempts: number;
  before_order: string[];
  after_order: string[];
  desired_order: string[];
  error_messages: string[];
  warnings: string[];
  rollback_snapshot_id: string;
}

export interface Config {
  apply_mode: 'dry-run' | 'apply';
  plex_url: string;
  kometa_config_path: string;
  max_reorder_retries: number;
  simulate_reorder_failure: boolean;
}

export interface KometaCollection {
  name: string;
  file_path: string;
  file_name: string;
  sort_title: string | null;
  collection_order: string | null;
  visible_home: boolean | null;
  visible_library: boolean | null;
  schedule: string | null;
  template_name: string | null;
}

// Layout Block for scheduling custom collection orders
export interface LayoutBlockItem {
  id: string;
  block_id: string;
  collection_id: string;
  order_index: number;
  visible_home: boolean;
  visible_shared_home: boolean;
  visible_shared_friends: boolean;
}

export interface LayoutBlock {
  id: string;
  library_section_id: string;
  name: string;
  start_at: string; // ISO datetime
  end_at: string;   // ISO datetime
  repeat_yearly?: boolean;
  items?: LayoutBlockItem[];
}

export interface LayoutBlockCreate {
  name: string;
  start_at: string;
  end_at: string;
  repeat_yearly?: boolean;
}

export interface LayoutBlockUpdate {
  name?: string;
  start_at?: string;
  end_at?: string;
  repeat_yearly?: boolean;
}

// Sync Settings Types
export type SyncResultStatus = 'in_sync' | 'applied' | 'no_active_block' | 'error';

export interface LibrarySyncSettings {
  library_section_id: string;
  sync_enabled: boolean;
  interval_minutes: number;
  last_checked_at: string | null;
  last_applied_at: string | null;
  last_result: SyncResultStatus | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LibrarySyncSettingsUpdate {
  sync_enabled?: boolean;
  interval_minutes?: number;
}

export interface ApplyIfNeededResult {
  status: SyncResultStatus;
  library_section_id: string;
  checked_at: string;
  active_block_id: string | null;
  active_block_name: string | null;
  changes_applied: number;
  visibility_changes: number;
  order_changes: number;
  error_message: string | null;
  rollback_snapshot_id: string | null;
}

// Rollback Types
export interface RollbackSnapshot {
  id: string;
  library_section_id: string;
  hub_order: string[];
  hub_visibility: Record<string, boolean>;
  note: string | null;
  created_at: string;
}

export interface RollbackResult {
  success: boolean;
  timestamp: string;
  library_section_id: string;
  snapshot_id: string;
  visibility_applied: number;
  visibility_failed: number;
  order_applied: boolean;
  errors: string[];
  pre_rollback_snapshot_id: string;
}

// Schedule Conflict Types
export type ConflictType = 'deleted_during_block' | 'not_yet_created' | 'never_created' | 'partial_coverage';

export interface ScheduleConflict {
  collection_name: string;
  collection_id: string;
  conflict_type: ConflictType;
  message: string;
  conflict_start: string | null;
  conflict_end: string | null;
  kometa_schedule: string;
  suggested_schedule: string | null;
}

export interface BlockConflictsResponse {
  block_id: string;
  block_name: string;
  block_start: string;
  block_end: string;
  delete_not_scheduled: boolean;
  conflicts: ScheduleConflict[];
  has_conflicts: boolean;
}

export interface CollectionScheduleInfo {
  collection_name: string;
  found_in_kometa: boolean;
  file_name?: string;
  schedule_raw?: string | null;
  schedule_type?: string;
  is_active: boolean;
  explanation?: string;
  next_change?: string | null;
  next_change_type?: string | null;
  evaluated_at?: string;
  visible_home?: boolean | string | null;
  visible_shared?: boolean | string | null;
  visible_library?: boolean | string | null;
  message?: string;
}

// Promotion Types - Overlays that boost specific collections to the top
export interface PromotionItem {
  id: string;
  promotion_id: string;
  hub_identifier: string;
  order_index: number;
  visible_home: boolean;
  visible_shared_home: boolean;
  visible_shared_friends: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Promotion {
  id: string;
  library_section_id: string;
  name: string;
  start_at: string; // ISO datetime
  end_at: string;   // ISO datetime
  repeat_yearly: boolean;
  items_count: number;
  items?: PromotionItem[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PromotionCreate {
  name: string;
  start_at: string;
  end_at: string;
  repeat_yearly: boolean;
}

export interface PromotionUpdate {
  name?: string;
  start_at?: string;
  end_at?: string;
  repeat_yearly?: boolean;
}

export interface PromotionItemSave {
  hub_identifier: string;
  order_index: number;
  visible_home: boolean;
  visible_shared_home: boolean;
  visible_shared_friends: boolean;
}
