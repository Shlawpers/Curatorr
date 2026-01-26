import { useState, useEffect } from 'react';
import { Plus, Calendar, Trash2, ChevronRight, Layers, Pencil, Copy, Star, RefreshCw, Save, FolderOpen, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { LayoutBlock, LayoutBlockUpdate, Promotion, PromotionCreate, PromotionUpdate } from '../types';
import { ConflictBadge } from './ConflictsIndicator';
import type { SavedLayout } from '../hooks/useApi';

// Re-export for convenience
export type { LayoutBlock } from '../types';

interface LoadResult {
  success: boolean;
  block_id: string;
  name: string;
  items_loaded: number;
  items_skipped: number;
  skipped_collections: string[];
  message: string;
}

interface Props {
  // Schedule props
  layoutBlocks: LayoutBlock[];
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string | null) => void;
  onCreateBlock: (block: Omit<LayoutBlock, 'id'>) => Promise<string>;
  onUpdateBlock: (blockId: string, updates: LayoutBlockUpdate) => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
  onDuplicateBlock: (blockId: string) => Promise<void>;
  // Saved layouts props
  savedLayouts: SavedLayout[];
  onSaveLayout: (blockId: string, name: string, description?: string) => Promise<{ success: boolean; message: string }>;
  onLoadSavedLayout: (layoutId: string, name: string, startAt: string, endAt: string, repeatYearly: boolean) => Promise<LoadResult>;
  onDeleteSavedLayout: (layoutId: string) => Promise<void>;
  onRefreshSavedLayouts: () => Promise<void>;
  // Promotion props
  promotions: Promotion[];
  selectedPromotionId: string | null;
  onSelectPromotion: (promotionId: string | null) => void;
  onCreatePromotion: (promotion: PromotionCreate) => Promise<string>;
  onUpdatePromotion: (promotionId: string, updates: PromotionUpdate) => Promise<void>;
  onDeletePromotion: (promotionId: string) => Promise<void>;
  // Common props
  libraryId: string;
}

type BlockStatus = 'active' | 'future' | 'past';

export function LayoutBlocksPanel({
  layoutBlocks,
  selectedBlockId,
  onSelectBlock,
  onCreateBlock,
  onUpdateBlock,
  onDeleteBlock,
  onDuplicateBlock,
  savedLayouts,
  onSaveLayout,
  onLoadSavedLayout,
  onDeleteSavedLayout,
  onRefreshSavedLayouts,
  promotions,
  selectedPromotionId,
  onSelectPromotion,
  onCreatePromotion,
  onUpdatePromotion,
  onDeletePromotion,
  libraryId,
}: Props) {
  // Load result state (for showing warnings after loading a saved layout)
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);

  // Save layout modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [saveLayoutDescription, setSaveLayoutDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Load saved layout modal state
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedSavedLayout, setSelectedSavedLayout] = useState<SavedLayout | null>(null);
  const [loadLayoutName, setLoadLayoutName] = useState('');
  const [loadLayoutStart, setLoadLayoutStart] = useState('');
  const [loadLayoutEnd, setLoadLayoutEnd] = useState('');
  const [loadLayoutRepeat, setLoadLayoutRepeat] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch saved layouts when modal opens
  useEffect(() => {
    if (showLoadModal) {
      onRefreshSavedLayouts();
    }
  }, [showLoadModal, onRefreshSavedLayouts]);

  // Schedule form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBlockName, setNewBlockName] = useState('');
  const [newBlockStart, setNewBlockStart] = useState('');
  const [newBlockEnd, setNewBlockEnd] = useState('');
  const [newBlockRepeat, setNewBlockRepeat] = useState(false);
  const [creating, setCreating] = useState(false);

  // Schedule edit form state
  const [editingBlock, setEditingBlock] = useState<LayoutBlock | null>(null);
  const [editBlockName, setEditBlockName] = useState('');
  const [editBlockStart, setEditBlockStart] = useState('');
  const [editBlockEnd, setEditBlockEnd] = useState('');
  const [editBlockRepeat, setEditBlockRepeat] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Promotion form state
  const [showPromotionForm, setShowPromotionForm] = useState(false);
  const [newPromoName, setNewPromoName] = useState('');
  const [newPromoStart, setNewPromoStart] = useState('');
  const [newPromoEnd, setNewPromoEnd] = useState('');
  const [newPromoRepeat, setNewPromoRepeat] = useState(false);
  const [creatingPromo, setCreatingPromo] = useState(false);

  // Promotion edit form state
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [editPromoName, setEditPromoName] = useState('');
  const [editPromoStart, setEditPromoStart] = useState('');
  const [editPromoEnd, setEditPromoEnd] = useState('');
  const [editPromoRepeat, setEditPromoRepeat] = useState(false);
  const [updatingPromo, setUpdatingPromo] = useState(false);

  const handleCreate = async () => {
    if (!newBlockName || !newBlockStart || !newBlockEnd) return;

    setCreating(true);
    try {
      const blockId = await onCreateBlock({
        library_section_id: libraryId,
        name: newBlockName,
        start_at: new Date(newBlockStart).toISOString(),
        end_at: new Date(newBlockEnd).toISOString(),
        repeat_yearly: newBlockRepeat,
      });

      setNewBlockName('');
      setNewBlockStart('');
      setNewBlockEnd('');
      setNewBlockRepeat(false);
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
    if (confirm('Delete this schedule? The default order will be used during this time period.')) {
      await onDeleteBlock(blockId);
      if (selectedBlockId === blockId) {
        onSelectBlock(null);
      }
    }
  };

  const handleDuplicate = async (blockId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await onDuplicateBlock(blockId);
    } catch (err) {
      console.error('Failed to duplicate schedule:', err);
    }
  };

  const handleSaveClick = (block: LayoutBlock, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavingBlockId(block.id);
    setSaveLayoutName(block.name);
    setSaveLayoutDescription('');
    setShowSaveModal(true);
  };

  const handleSaveLayout = async () => {
    if (!savingBlockId || !saveLayoutName) return;

    setSaving(true);
    try {
      await onSaveLayout(savingBlockId, saveLayoutName, saveLayoutDescription || undefined);
      setShowSaveModal(false);
      setSavingBlockId(null);
      setSaveLayoutName('');
      setSaveLayoutDescription('');
    } catch (err) {
      console.error('Failed to save layout:', err);
      alert('Failed to save layout: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleLoadClick = () => {
    setShowLoadModal(true);
    setSelectedSavedLayout(null);
    setLoadLayoutName('');
    setLoadLayoutStart('');
    setLoadLayoutEnd('');
    setLoadLayoutRepeat(false);
  };

  const handleSelectSavedLayout = (layout: SavedLayout) => {
    setSelectedSavedLayout(layout);
    setLoadLayoutName(layout.name);
    // Set default dates (now to 1 week from now)
    const now = new Date();
    const oneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    setLoadLayoutStart(format(now, "yyyy-MM-dd'T'HH:mm"));
    setLoadLayoutEnd(format(oneWeek, "yyyy-MM-dd'T'HH:mm"));
    setLoadLayoutRepeat(false);
  };

  const handleLoadLayout = async () => {
    if (!selectedSavedLayout || !loadLayoutName || !loadLayoutStart || !loadLayoutEnd) return;

    setLoading(true);
    try {
      const result = await onLoadSavedLayout(
        selectedSavedLayout.id,
        loadLayoutName,
        new Date(loadLayoutStart).toISOString(),
        new Date(loadLayoutEnd).toISOString(),
        loadLayoutRepeat
      );
      setShowLoadModal(false);
      setLoadResult(result);

      // Select the newly created block
      if (result.success && result.block_id) {
        onSelectBlock(result.block_id);
      }
    } catch (err) {
      console.error('Failed to load saved layout:', err);
      alert('Failed to load layout: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSavedLayout = async (layoutId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this saved layout? This cannot be undone.')) {
      try {
        await onDeleteSavedLayout(layoutId);
        if (selectedSavedLayout?.id === layoutId) {
          setSelectedSavedLayout(null);
        }
      } catch (err) {
        console.error('Failed to delete saved layout:', err);
        alert('Failed to delete: ' + (err instanceof Error ? err.message : 'Unknown error'));
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
    setEditBlockRepeat(block.repeat_yearly || false);
  };

  const handleUpdate = async () => {
    if (!editingBlock || !editBlockName || !editBlockStart || !editBlockEnd) return;

    setUpdating(true);
    try {
      await onUpdateBlock(editingBlock.id, {
        name: editBlockName,
        start_at: new Date(editBlockStart).toISOString(),
        end_at: new Date(editBlockEnd).toISOString(),
        repeat_yearly: editBlockRepeat,
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
      // Always use real current time for sidebar status (not preview time)
      const now = new Date();

      // For yearly repeating blocks, adjust dates to current year
      if (block.repeat_yearly) {
        const thisYearStart = new Date(start);
        thisYearStart.setFullYear(now.getFullYear());
        const thisYearEnd = new Date(end);
        thisYearEnd.setFullYear(now.getFullYear());

        // Handle year-boundary case (e.g., Dec 20 - Jan 5)
        if (thisYearEnd < thisYearStart) {
          // Check if we're in the late part (Dec) or early part (Jan)
          const lastYearStart = new Date(thisYearStart);
          lastYearStart.setFullYear(now.getFullYear() - 1);

          // Try last year's start to this year's end (e.g., Dec 20 2025 - Jan 5 2026)
          if (now >= lastYearStart && now < thisYearEnd) {
            return 'active';
          }
          // Try this year's start to next year's end (e.g., Dec 20 2026 - Jan 5 2027)
          const nextYearEnd = new Date(thisYearEnd);
          nextYearEnd.setFullYear(now.getFullYear() + 1);
          if (now >= thisYearStart && now < nextYearEnd) {
            return 'active';
          }
          // Check if upcoming this year
          if (now < thisYearStart) {
            return 'future';
          }
          return 'past';
        }

        if (now >= thisYearStart && now < thisYearEnd) {
          return 'active';
        }
        if (now < thisYearStart) {
          return 'future';
        }
        return 'past';
      }

      // Non-repeating: use original dates
      if (now >= start && now < end) {
        return 'active';
      }
      if (now < start) {
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
        return 'Active now';
      case 'future':
        return 'Upcoming';
      case 'past':
        return 'Ended';
    }
  };

  // Promotion handlers
  const handleCreatePromotion = async () => {
    if (!newPromoName || !newPromoStart || !newPromoEnd) return;

    setCreatingPromo(true);
    try {
      const promotionId = await onCreatePromotion({
        name: newPromoName,
        start_at: new Date(newPromoStart).toISOString(),
        end_at: new Date(newPromoEnd).toISOString(),
        repeat_yearly: newPromoRepeat,
      });

      setNewPromoName('');
      setNewPromoStart('');
      setNewPromoEnd('');
      setNewPromoRepeat(false);
      setShowPromotionForm(false);
      onSelectPromotion(promotionId);
    } catch (e) {
      console.error('Failed to create promotion:', e);
    } finally {
      setCreatingPromo(false);
    }
  };

  const handleDeletePromotion = async (promotionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this promotion?')) {
      await onDeletePromotion(promotionId);
      if (selectedPromotionId === promotionId) {
        onSelectPromotion(null);
      }
    }
  };

  const handleEditPromotionClick = (promotion: Promotion, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPromotion(promotion);
    setEditPromoName(promotion.name);
    const startDate = parseISO(promotion.start_at);
    const endDate = parseISO(promotion.end_at);
    setEditPromoStart(format(startDate, "yyyy-MM-dd'T'HH:mm"));
    setEditPromoEnd(format(endDate, "yyyy-MM-dd'T'HH:mm"));
    setEditPromoRepeat(promotion.repeat_yearly);
  };

  const handleUpdatePromotion = async () => {
    if (!editingPromotion || !editPromoName || !editPromoStart || !editPromoEnd) return;

    setUpdatingPromo(true);
    try {
      await onUpdatePromotion(editingPromotion.id, {
        name: editPromoName,
        start_at: new Date(editPromoStart).toISOString(),
        end_at: new Date(editPromoEnd).toISOString(),
        repeat_yearly: editPromoRepeat,
      });
      setEditingPromotion(null);
    } catch (e) {
      console.error('Failed to update promotion:', e);
    } finally {
      setUpdatingPromo(false);
    }
  };

  const getPromotionStatus = (promotion: Promotion): BlockStatus => {
    try {
      const start = parseISO(promotion.start_at);
      const end = parseISO(promotion.end_at);
      // Always use real current time for sidebar status (not preview time)
      const now = new Date();

      // For yearly repeating promotions, adjust dates to current year
      if (promotion.repeat_yearly) {
        const thisYearStart = new Date(start);
        thisYearStart.setFullYear(now.getFullYear());
        const thisYearEnd = new Date(end);
        thisYearEnd.setFullYear(now.getFullYear());

        // Handle year-boundary case (e.g., Dec 20 - Jan 5)
        if (thisYearEnd < thisYearStart) {
          // Check if we're in the late part (Dec) or early part (Jan)
          const lastYearStart = new Date(thisYearStart);
          lastYearStart.setFullYear(now.getFullYear() - 1);

          // Try last year's start to this year's end (e.g., Dec 20 2025 - Jan 5 2026)
          if (now >= lastYearStart && now < thisYearEnd) {
            return 'active';
          }
          // Try this year's start to next year's end (e.g., Dec 20 2026 - Jan 5 2027)
          const nextYearEnd = new Date(thisYearEnd);
          nextYearEnd.setFullYear(now.getFullYear() + 1);
          if (now >= thisYearStart && now < nextYearEnd) {
            return 'active';
          }
          // Check if upcoming this year
          if (now < thisYearStart) {
            return 'future';
          }
          return 'past';
        }

        if (now >= thisYearStart && now < thisYearEnd) {
          return 'active';
        }
        if (now < thisYearStart) {
          return 'future';
        }
        return 'past';
      }

      // Non-repeating: use original dates
      if (now >= start && now < end) {
        return 'active';
      }
      if (now < start) {
        return 'future';
      }
      return 'past';
    } catch {
      return 'past';
    }
  };

  // Sort promotions chronologically
  const sortedPromotions = [...promotions].sort((a, b) => {
    const aStart = new Date(a.start_at).getTime();
    const bStart = new Date(b.start_at).getTime();
    return aStart - bStart;
  });

  return (
    <div className="flex flex-col h-full pt-8 md:pt-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-sm font-semibold text-gray-400 uppercase tracking-wider cursor-help"
          title="Schedule a home hub layout for a specific date range"
        >
          Scheduled Layouts
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleLoadClick}
            className="p-1.5 hover:bg-plex-border rounded transition-colors"
            title="Load a saved layout"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="p-1.5 hover:bg-plex-border rounded transition-colors"
            title="Create a scheduled layout that replaces your home order during a date range"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Current Plex Layout */}
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
          <span className="font-medium text-sm">Current Plex Layout</span>
        </div>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          Your live Plex home order
        </p>
      </button>

      {/* Divider */}
      <div className="border-t border-plex-border my-3" />

      {/* Scheduled time blocks */}
      <div className="space-y-2 mb-4">
        {sortedBlocks.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            <Calendar className="w-6 h-6 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No schedules yet</p>
          </div>
        ) : (
          sortedBlocks.map(block => {
            const status = getBlockStatus(block);
            const isSelected = selectedBlockId === block.id && selectedPromotionId === null;

            return (
              <button
                key={block.id}
                onClick={() => { onSelectBlock(block.id); onSelectPromotion(null); }}
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
                    {block.repeat_yearly && (
                      <span title="Repeats yearly">
                        <RefreshCw className="w-3 h-3 text-purple-400 flex-shrink-0" />
                      </span>
                    )}
                    <ConflictBadge blockId={block.id} />
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleEditClick(block, e)}
                      className="p-1 hover:bg-plex-gold/20 rounded text-gray-400 hover:text-plex-gold"
                      title="Edit schedule"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleDuplicate(block.id, e)}
                      className="p-1 hover:bg-blue-500/20 rounded text-gray-400 hover:text-blue-400"
                      title="Duplicate schedule (shifts dates +1 year)"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleSaveClick(block, e)}
                      className="p-1 hover:bg-green-500/20 rounded text-gray-400 hover:text-green-400"
                      title="Save layout for reuse"
                    >
                      <Save className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(block.id, e)}
                      className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                      title="Delete schedule"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <ChevronRight className={`w-4 h-4 transition-transform ${
                      isSelected ? 'rotate-90' : ''
                    }`} />
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1 ml-4">
                  {block.repeat_yearly
                    ? `${format(parseISO(block.start_at), 'MMM d')} → ${format(parseISO(block.end_at), 'MMM d')}`
                    : `${format(parseISO(block.start_at), 'MMM d, yyyy h:mm a')} → ${format(parseISO(block.end_at), 'MMM d, yyyy h:mm a')}`
                  }
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

      {/* Promotions Section */}
      <div className="border-t border-plex-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-help"
            title="Boost specific collections to the top during date range without changing the rest"
          >
            <Star className="w-3.5 h-3.5" />
            Promotions
          </h2>
          <button
            onClick={() => setShowPromotionForm(true)}
            className="p-1.5 hover:bg-plex-border rounded transition-colors"
            title="Boost collections to the top during special dates without changing the rest"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {sortedPromotions.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <Star className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No promotions yet</p>
              <p className="text-xs mt-1 text-gray-600">Boost collections to the top during special dates</p>
            </div>
          ) : (
            sortedPromotions.map(promotion => {
              const status = getPromotionStatus(promotion);
              const isSelected = selectedPromotionId === promotion.id;

              return (
                <button
                  key={promotion.id}
                  onClick={() => { onSelectPromotion(promotion.id); onSelectBlock(null); }}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-purple-500/10 border-purple-500'
                      : status === 'past'
                      ? 'bg-plex-card/50 border-plex-border/50 opacity-60 hover:opacity-80'
                      : 'bg-plex-card border-plex-border hover:border-purple-500/50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {getStatusIndicator(status)}
                      <span className="font-medium text-sm truncate">{promotion.name}</span>
                      {promotion.repeat_yearly && (
                        <span title="Repeats yearly">
                          <RefreshCw className="w-3 h-3 text-purple-400" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => handleEditPromotionClick(promotion, e)}
                        className="p-1 hover:bg-purple-500/20 rounded text-gray-400 hover:text-purple-400"
                        title="Edit promotion"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDeletePromotion(promotion.id, e)}
                        className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                        title="Delete promotion"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <ChevronRight className={`w-4 h-4 transition-transform ${
                        isSelected ? 'rotate-90' : ''
                      }`} />
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 ml-4">
                    {promotion.repeat_yearly
                      ? `${format(parseISO(promotion.start_at), 'MMM d')} → ${format(parseISO(promotion.end_at), 'MMM d')}`
                      : `${format(parseISO(promotion.start_at), 'MMM d, yyyy')} → ${format(parseISO(promotion.end_at), 'MMM d, yyyy')}`
                    }
                    {promotion.items_count > 0 && (
                      <span className="ml-2 text-purple-400">({promotion.items_count} items)</span>
                    )}
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
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create Schedule</h3>

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

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newBlockRepeat}
                  onChange={(e) => setNewBlockRepeat(e.target.checked)}
                  className="w-4 h-4 rounded border-plex-border bg-plex-dark
                           checked:bg-plex-gold focus:ring-plex-gold"
                />
                <RefreshCw className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-gray-300">Repeat yearly</span>
              </label>
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
            <h3 className="text-lg font-semibold mb-4">Edit Schedule</h3>

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

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editBlockRepeat}
                  onChange={(e) => setEditBlockRepeat(e.target.checked)}
                  className="w-4 h-4 rounded border-plex-border bg-plex-dark
                           checked:bg-plex-gold focus:ring-plex-gold"
                />
                <RefreshCw className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-gray-300">Repeat yearly</span>
              </label>
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

      {/* Promotion Create Form Modal */}
      {showPromotionForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-purple-400" />
              Create Promotion
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newPromoName}
                  onChange={(e) => setNewPromoName(e.target.value)}
                  placeholder="e.g., Christmas Picks"
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  value={newPromoStart}
                  onChange={(e) => setNewPromoStart(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">End</label>
                <input
                  type="datetime-local"
                  value={newPromoEnd}
                  onChange={(e) => setNewPromoEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="repeat-yearly"
                  checked={newPromoRepeat}
                  onChange={(e) => setNewPromoRepeat(e.target.checked)}
                  className="w-4 h-4 rounded border-plex-border bg-plex-dark
                           focus:ring-purple-500 focus:ring-2 accent-purple-500"
                />
                <label htmlFor="repeat-yearly" className="text-sm text-gray-300 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-purple-400" />
                  Repeat yearly
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowPromotionForm(false)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                         hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePromotion}
                disabled={creatingPromo || !newPromoName || !newPromoStart || !newPromoEnd}
                className="px-4 py-2 bg-purple-600 text-white rounded
                         hover:bg-purple-500 transition-colors disabled:opacity-50"
              >
                {creatingPromo ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promotion Edit Form Modal */}
      {editingPromotion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-purple-400" />
              Edit Promotion
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={editPromoName}
                  onChange={(e) => setEditPromoName(e.target.value)}
                  placeholder="e.g., Christmas Picks"
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  value={editPromoStart}
                  onChange={(e) => setEditPromoStart(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">End</label>
                <input
                  type="datetime-local"
                  value={editPromoEnd}
                  onChange={(e) => setEditPromoEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="edit-repeat-yearly"
                  checked={editPromoRepeat}
                  onChange={(e) => setEditPromoRepeat(e.target.checked)}
                  className="w-4 h-4 rounded border-plex-border bg-plex-dark
                           focus:ring-purple-500 focus:ring-2 accent-purple-500"
                />
                <label htmlFor="edit-repeat-yearly" className="text-sm text-gray-300 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-purple-400" />
                  Repeat yearly
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditingPromotion(null)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                         hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdatePromotion}
                disabled={updatingPromo || !editPromoName || !editPromoStart || !editPromoEnd}
                className="px-4 py-2 bg-purple-600 text-white rounded
                         hover:bg-purple-500 transition-colors disabled:opacity-50"
              >
                {updatingPromo ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Layout Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Save className="w-5 h-5 text-green-400" />
              Save Layout
            </h3>

            <p className="text-sm text-gray-400 mb-4">
              Save this layout as a reusable template. You can load it later to create new scheduled layouts.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={saveLayoutName}
                  onChange={(e) => setSaveLayoutName(e.target.value)}
                  placeholder="e.g., Halloween Layout"
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
                <textarea
                  value={saveLayoutDescription}
                  onChange={(e) => setSaveLayoutDescription(e.target.value)}
                  placeholder="Add notes about this layout..."
                  rows={2}
                  className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                           focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                         hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLayout}
                disabled={saving || !saveLayoutName}
                className="px-4 py-2 bg-green-600 text-white rounded
                         hover:bg-green-500 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Layout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Saved Layout Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-plex-gold" />
                Load Saved Layout
              </h3>
              <button
                onClick={() => setShowLoadModal(false)}
                className="p-1 hover:bg-plex-border rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {savedLayouts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Save className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p>No saved layouts yet</p>
                <p className="text-sm mt-1">Save a layout from an existing schedule to reuse it later</p>
              </div>
            ) : (
              <>
                {/* Saved layouts list */}
                <div className="flex-1 overflow-y-auto mb-4 space-y-2 max-h-48">
                  {savedLayouts.map(layout => (
                    <button
                      key={layout.id}
                      onClick={() => handleSelectSavedLayout(layout)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        selectedSavedLayout?.id === layout.id
                          ? 'bg-plex-gold/10 border-plex-gold'
                          : 'bg-plex-dark border-plex-border hover:border-plex-gold/50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-sm">{layout.name}</span>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {layout.items_count} collections
                            {layout.description && (
                              <span className="ml-2">• {layout.description}</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">
                            Saved {format(parseISO(layout.created_at), 'MMM d, yyyy h:mm a')}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteSavedLayout(layout.id, e)}
                          className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 flex-shrink-0"
                          title="Delete saved layout"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Schedule form (shown when a layout is selected) */}
                {selectedSavedLayout && (
                  <div className="border-t border-plex-border pt-4 space-y-4">
                    <p className="text-sm text-gray-400">
                      Set the schedule for when this layout should be active:
                    </p>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Schedule Name</label>
                      <input
                        type="text"
                        value={loadLayoutName}
                        onChange={(e) => setLoadLayoutName(e.target.value)}
                        className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                                 focus:outline-none focus:ring-2 focus:ring-plex-gold"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Start</label>
                        <input
                          type="datetime-local"
                          value={loadLayoutStart}
                          onChange={(e) => setLoadLayoutStart(e.target.value)}
                          className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                                   focus:outline-none focus:ring-2 focus:ring-plex-gold text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-gray-400 mb-1">End</label>
                        <input
                          type="datetime-local"
                          value={loadLayoutEnd}
                          onChange={(e) => setLoadLayoutEnd(e.target.value)}
                          className="w-full px-3 py-2 bg-plex-dark border border-plex-border rounded
                                   focus:outline-none focus:ring-2 focus:ring-plex-gold text-sm"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={loadLayoutRepeat}
                        onChange={(e) => setLoadLayoutRepeat(e.target.checked)}
                        className="w-4 h-4 rounded border-plex-border bg-plex-dark
                                 checked:bg-plex-gold focus:ring-plex-gold"
                      />
                      <RefreshCw className="w-4 h-4 text-purple-400" />
                      <span className="text-sm text-gray-300">Repeat yearly</span>
                    </label>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-plex-border">
              <button
                onClick={() => setShowLoadModal(false)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                         hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLoadLayout}
                disabled={loading || !selectedSavedLayout || !loadLayoutName || !loadLayoutStart || !loadLayoutEnd}
                className="px-4 py-2 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Result Modal */}
      {loadResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-green-400" />
              Layout Loaded
            </h3>

            <div className="space-y-3">
              <p className="text-sm text-gray-300">
                <span className="text-white font-medium">{loadResult.name}</span> has been created.
              </p>

              <div className="flex gap-4 text-sm">
                <span className="text-green-400">
                  {loadResult.items_loaded} collections loaded
                </span>
                {loadResult.items_skipped > 0 && (
                  <span className="text-yellow-400">
                    {loadResult.items_skipped} skipped
                  </span>
                )}
              </div>

              {loadResult.skipped_collections.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
                  <p className="text-xs text-yellow-400 font-medium mb-2">
                    Collections not found in Plex (skipped):
                  </p>
                  <ul className="text-xs text-yellow-300 space-y-1">
                    {loadResult.skipped_collections.map((name, idx) => (
                      <li key={idx}>• {name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setLoadResult(null)}
                className="px-4 py-2 bg-plex-gold text-black rounded
                         hover:bg-plex-orange transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
