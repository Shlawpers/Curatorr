import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, XCircle, Wrench, Loader2, CheckCircle, X } from 'lucide-react';
import type { BlockConflictsResponse, ScheduleConflict } from '../types';
import { fixKometaSchedule, FixKometaScheduleResult } from '../hooks/useApi';

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
            <ConflictItem
              key={index}
              conflict={conflict}
              onFixed={() => {
                // Refresh conflicts after a fix
                if (blockId) {
                  fetch(`/api/layout-blocks/${blockId}/conflicts`)
                    .then(res => res.json())
                    .then(data => setConflicts(data))
                    .catch(console.error);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConflictItemProps {
  conflict: ScheduleConflict;
  onFixed?: () => void;
}

function ConflictItem({ conflict, onFixed }: ConflictItemProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixKometaScheduleResult | null>(null);

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

  const handleFixClick = () => {
    setShowConfirm(true);
    setFixResult(null);
  };

  const handleConfirmFix = async () => {
    if (!conflict.suggested_schedule) return;

    setFixing(true);
    try {
      const result = await fixKometaSchedule(
        conflict.collection_name,
        conflict.suggested_schedule
      );
      setFixResult(result);
      if (result.success) {
        // Wait a moment to show success, then close
        setTimeout(() => {
          setShowConfirm(false);
          onFixed?.();
        }, 1500);
      }
    } catch (e) {
      setFixResult({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to apply fix',
        file_path: null,
        old_schedule: conflict.kometa_schedule || null,
        new_schedule: conflict.suggested_schedule,
      });
    } finally {
      setFixing(false);
    }
  };

  return (
    <>
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
              <div className="flex items-center gap-2 mt-2">
                <div className="text-xs text-green-400 flex-1">
                  <span className="text-gray-500">Suggested fix:</span>{' '}
                  <code className="bg-green-500/10 px-1 rounded">{conflict.suggested_schedule}</code>
                </div>
                <button
                  onClick={handleFixClick}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
                  title="Apply this fix to the Kometa YAML file"
                >
                  <Wrench className="w-3 h-3" />
                  Fix
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-4 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-lg">Fix Kometa Schedule</h3>
              <button
                onClick={() => setShowConfirm(false)}
                className="p-1 hover:bg-plex-border rounded transition-colors"
                disabled={fixing}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {fixResult ? (
              <div className={`p-3 rounded ${fixResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2">
                  {fixResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400" />
                  )}
                  <span className={fixResult.success ? 'text-green-400' : 'text-red-400'}>
                    {fixResult.message}
                  </span>
                </div>
                {fixResult.file_path && (
                  <div className="text-xs text-gray-500 mt-2 truncate">
                    File: {fixResult.file_path}
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-300 mb-4">
                  This will modify the Kometa YAML file for <strong>{conflict.collection_name}</strong>:
                </p>

                <div className="space-y-2 mb-4">
                  <div className="text-xs">
                    <span className="text-gray-500">Current:</span>
                    <code className="ml-2 bg-red-500/10 text-red-400 px-2 py-1 rounded block mt-1">
                      schedule: {conflict.kometa_schedule || '(none)'}
                    </code>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-500">New:</span>
                    <code className="ml-2 bg-green-500/10 text-green-400 px-2 py-1 rounded block mt-1">
                      schedule: {conflict.suggested_schedule}
                    </code>
                  </div>
                </div>

                <p className="text-xs text-gray-500 mb-4">
                  Note: Kometa volume must be mounted read-write for this to work.
                </p>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                    disabled={fixing}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmFix}
                    disabled={fixing}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 text-white rounded transition-colors disabled:opacity-50"
                  >
                    {fixing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <Wrench className="w-4 h-4" />
                        Apply Fix
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
