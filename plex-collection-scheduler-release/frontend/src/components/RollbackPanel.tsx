import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  History,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useRollback } from '../hooks/useApi';
import type { Library, RollbackResult } from '../types';

interface RollbackPanelProps {
  library: Library;
  onClose: () => void;
  onRollbackComplete?: () => void;
}

export function RollbackPanel({ library, onClose, onRollbackComplete }: RollbackPanelProps) {
  const {
    snapshots,
    loading,
    error,
    fetchSnapshots,
    rollbackToSnapshot,
  } = useRollback(library.key);

  const [rolling, setRolling] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);
  const [confirmSnapshotId, setConfirmSnapshotId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch snapshots on mount - use empty deps to ensure fresh fetch every time panel opens
  useEffect(() => {
    fetchSnapshots(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRollback = async (snapshotId: string) => {
    setRolling(true);
    setRollbackResult(null);
    setConfirmSnapshotId(null);
    try {
      const result = await rollbackToSnapshot(snapshotId);
      setRollbackResult(result);
      if (result.success) {
        // Auto-close modal after brief delay to show success, then refresh
        setTimeout(() => {
          if (onRollbackComplete) {
            onRollbackComplete();
          }
          onClose();
        }, 1500);
      }
    } catch (e) {
      console.error('Rollback failed:', e);
    } finally {
      setRolling(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-plex-dark border border-plex-border rounded-xl w-full max-w-2xl max-h-[80vh] shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-plex-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-plex-gold" />
            <h2 className="text-lg font-semibold">Rollback History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-plex-border rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Library Info */}
          <div className="bg-plex-card border border-plex-border rounded-lg p-3 mb-4">
            <p className="text-sm text-gray-400">Library</p>
            <p className="font-medium">{library.title}</p>
          </div>

          {/* Rollback Result */}
          {rollbackResult && (
            <div className={`mb-4 p-3 rounded-lg border ${
              rollbackResult.success
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {rollbackResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                )}
                <span className={`font-medium ${rollbackResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {rollbackResult.success ? 'Rollback Successful' : 'Rollback Failed'}
                </span>
              </div>
              {rollbackResult.success && (
                <p className="text-sm text-gray-400">
                  Applied {rollbackResult.visibility_applied} visibility change{rollbackResult.visibility_applied !== 1 ? 's' : ''}
                  {rollbackResult.order_applied && ', reordered hubs'}
                </p>
              )}
              {rollbackResult.errors.length > 0 && (
                <ul className="text-sm text-red-400 mt-2">
                  {rollbackResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Loading */}
          {loading && !snapshots.length && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-plex-gold" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-lg mb-4">
              {error}
            </div>
          )}

          {/* Snapshots List */}
          {snapshots.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 uppercase tracking-wider mb-2">
                Recent Snapshots
              </p>
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="bg-plex-card border border-plex-border rounded-lg overflow-hidden"
                >
                  {/* Snapshot Header */}
                  <div
                    className="p-3 cursor-pointer hover:bg-plex-border/30 transition-colors"
                    onClick={() => toggleExpanded(snapshot.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {format(parseISO(snapshot.created_at), 'MMM d, yyyy h:mm:ss a')}
                        </p>
                        {snapshot.note && (
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {snapshot.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {confirmSnapshotId === snapshot.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRollback(snapshot.id);
                              }}
                              disabled={rolling}
                              className="px-2 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmSnapshotId(null);
                              }}
                              className="px-2 py-1 text-xs bg-plex-border rounded hover:bg-plex-border/80 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmSnapshotId(snapshot.id);
                            }}
                            disabled={rolling}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-plex-gold/10 text-plex-gold border border-plex-gold/30 rounded hover:bg-plex-gold/20 transition-colors disabled:opacity-50"
                            title="Rollback to this snapshot"
                          >
                            {rolling ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                            Rollback
                          </button>
                        )}
                        {expandedId === snapshot.id ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedId === snapshot.id && (
                    <div className="px-3 pb-3 border-t border-plex-border/50 pt-2">
                      <p className="text-xs text-gray-500 mb-1">ID: {snapshot.id}</p>
                      <p className="text-xs text-gray-400 mb-2">
                        Hubs: {snapshot.hub_order.length} |
                        Promoted: {Object.values(snapshot.hub_visibility).filter(v => v).length}
                      </p>
                      {snapshot.hub_order.length > 0 && (
                        <div className="text-xs">
                          <p className="text-gray-500 mb-1">Hub Order:</p>
                          <div className="max-h-24 overflow-y-auto bg-plex-darker rounded p-2">
                            {snapshot.hub_order.slice(0, 10).map((hubId, i) => (
                              <p key={hubId} className="text-gray-400 truncate">
                                {i + 1}. {hubId}
                              </p>
                            ))}
                            {snapshot.hub_order.length > 10 && (
                              <p className="text-gray-500 italic">
                                ...and {snapshot.hub_order.length - 10} more
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : !loading && (
            <div className="text-center py-8 text-gray-500">
              <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No rollback snapshots yet</p>
              <p className="text-sm">Snapshots are created when changes are applied</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-plex-border flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-plex-card border border-plex-border rounded
                       hover:border-plex-gold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
