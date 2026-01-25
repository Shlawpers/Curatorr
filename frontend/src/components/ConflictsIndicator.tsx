import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, XCircle } from 'lucide-react';
import type { BlockConflictsResponse, ScheduleConflict } from '../types';

interface ConflictBadgeProps {
  blockId: string;
  onConflictsLoaded?: (hasConflicts: boolean, count: number) => void;
}

// Small badge that shows conflict count
export function ConflictBadge({ blockId, onConflictsLoaded }: ConflictBadgeProps) {
  const [conflicts, setConflicts] = useState<BlockConflictsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConflicts = async () => {
      try {
        const response = await fetch(`/api/layout-blocks/${blockId}/conflicts`);
        if (response.ok) {
          const data = await response.json();
          setConflicts(data);
          onConflictsLoaded?.(data.has_conflicts, data.conflicts.length);
        }
      } catch (e) {
        console.error('Failed to fetch conflicts:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchConflicts();
  }, [blockId, onConflictsLoaded]);

  if (loading || !conflicts?.has_conflicts) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs"
      title={`${conflicts.conflicts.length} schedule conflict(s)`}
    >
      <AlertTriangle className="w-3 h-3" />
      <span>{conflicts.conflicts.length}</span>
    </div>
  );
}

interface ConflictsPanelProps {
  blockId: string | null;
  expanded?: boolean;
}

// Expandable panel showing conflict details
export function ConflictsPanel({ blockId, expanded = true }: ConflictsPanelProps) {
  const [conflicts, setConflicts] = useState<BlockConflictsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(expanded);

  useEffect(() => {
    if (!blockId) {
      setConflicts(null);
      return;
    }

    const fetchConflicts = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/layout-blocks/${blockId}/conflicts`);
        if (response.ok) {
          const data = await response.json();
          setConflicts(data);
        } else {
          setError('Failed to check conflicts');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to check conflicts');
      } finally {
        setLoading(false);
      }
    };

    fetchConflicts();
  }, [blockId]);

  if (!blockId) {
    return null;
  }

  if (loading) {
    return (
      <div className="p-3 text-sm text-gray-500">
        Checking for schedule conflicts...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (!conflicts?.has_conflicts) {
    return (
      <div className="p-3 text-sm text-green-400 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        No schedule conflicts detected
      </div>
    );
  }

  return (
    <div className="border border-amber-500/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="font-medium text-amber-400">
            {conflicts.conflicts.length} Schedule Conflict{conflicts.conflicts.length !== 1 ? 's' : ''}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="p-3 space-y-3">
          <p className="text-xs text-gray-400">
            These collections may not exist during part of this block's time range:
          </p>

          {conflicts.conflicts.map((conflict, index) => (
            <ConflictItem key={index} conflict={conflict} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConflictItemProps {
  conflict: ScheduleConflict;
}

function ConflictItem({ conflict }: ConflictItemProps) {
  const getIcon = () => {
    switch (conflict.conflict_type) {
      case 'deleted_during_block':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'not_yet_created':
        return <Clock className="w-4 h-4 text-blue-400" />;
      case 'never_created':
        return <XCircle className="w-4 h-4 text-gray-400" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    }
  };

  const getTypeLabel = () => {
    switch (conflict.conflict_type) {
      case 'deleted_during_block':
        return 'Will be deleted';
      case 'not_yet_created':
        return 'Not yet created';
      case 'never_created':
        return 'Never runs';
      default:
        return 'Conflict';
    }
  };

  return (
    <div className="bg-plex-dark/50 rounded p-3 text-sm">
      <div className="flex items-start gap-2">
        {getIcon()}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{conflict.collection_name}</div>
          <div className="text-xs text-gray-500 mt-1">{getTypeLabel()}</div>
          <div className="text-xs text-gray-400 mt-1">{conflict.message}</div>

          {conflict.kometa_schedule && (
            <div className="text-xs text-gray-500 mt-2">
              <span className="text-gray-600">Kometa schedule:</span>{' '}
              <code className="bg-plex-border/50 px-1 rounded">{conflict.kometa_schedule}</code>
            </div>
          )}

          {conflict.suggested_schedule && (
            <div className="text-xs text-green-400 mt-1">
              <span className="text-gray-500">Suggested fix:</span>{' '}
              <code className="bg-green-500/10 px-1 rounded">{conflict.suggested_schedule}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
