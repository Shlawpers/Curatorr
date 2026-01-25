import { useState } from 'react';
import {
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Loader2,
} from 'lucide-react';
import type { Diff, ApplyResult } from '../types';

interface Props {
  diff: Diff | null;
  loading: boolean;
  applyMode: 'dry-run' | 'apply';
  onApply: () => Promise<void>;
  applyResult: ApplyResult | null;
  applyLoading: boolean;
}

export function DiffPanel({
  diff,
  loading,
  applyMode,
  onApply,
  applyResult,
  applyLoading,
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

  if (loading) {
    return (
      <div className="bg-plex-card border border-plex-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Computing diff...
        </div>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="bg-plex-card border border-plex-border rounded-lg p-4">
        <p className="text-gray-500">Select a library to view changes</p>
      </div>
    );
  }

  const hasChanges = diff.total_changes > 0;

  return (
    <div className="bg-plex-card border border-plex-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-plex-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Pending Changes</h3>
            <p className="text-sm text-gray-400">
              {diff.total_changes} change{diff.total_changes !== 1 ? 's' : ''} to apply
            </p>
          </div>

          {hasChanges && (
            <div className="flex items-center gap-2">
              {applyMode === 'dry-run' ? (
                <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                  Dry-run mode
                </span>
              ) : (
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={applyLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-plex-gold text-black rounded
                             hover:bg-plex-orange transition-colors disabled:opacity-50"
                >
                  {applyLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Apply Now
                </button>
              )}
            </div>
          )}
        </div>

        {/* Conflicts Warning */}
        {diff.has_conflicts && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-400 font-medium">Conflicts Detected</p>
              <ul className="text-xs text-red-400/80 mt-1 list-disc list-inside">
                {diff.conflict_messages.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Changes List */}
      <div className="divide-y divide-plex-border max-h-96 overflow-y-auto">
        {/* Visibility Changes */}
        {diff.visibility_changes.map(change => (
          <div
            key={change.collection_id}
            className="flex items-center gap-3 p-3 hover:bg-plex-dark/50"
          >
            {change.to === 'home' ? (
              <div className="w-8 h-8 flex items-center justify-center bg-green-500/20 rounded">
                <Eye className="w-4 h-4 text-green-400" />
              </div>
            ) : (
              <div className="w-8 h-8 flex items-center justify-center bg-red-500/20 rounded">
                <EyeOff className="w-4 h-4 text-red-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{change.title}</p>
              <p className="text-xs text-gray-400">
                Visibility: {change.from} → {change.to}
              </p>
            </div>
          </div>
        ))}

        {/* Order Changes */}
        {diff.order_changes.map(change => (
          <div
            key={change.collection_id}
            className="flex items-center gap-3 p-3 hover:bg-plex-dark/50"
          >
            <div className="w-8 h-8 flex items-center justify-center bg-blue-500/20 rounded">
              {change.from_position !== null && change.to_position < change.from_position ? (
                <ArrowUp className="w-4 h-4 text-blue-400" />
              ) : (
                <ArrowDown className="w-4 h-4 text-blue-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{change.title}</p>
              <p className="text-xs text-gray-400">
                Position: {change.from_position ?? '?'} → {change.to_position + 1}
              </p>
            </div>
          </div>
        ))}

        {/* No Changes */}
        {!hasChanges && (
          <div className="flex flex-col items-center justify-center p-8 text-gray-500">
            <CheckCircle className="w-8 h-8 mb-2 text-green-500" />
            <p>No changes needed</p>
            <p className="text-xs">Plex Home matches the scheduled state</p>
          </div>
        )}
      </div>

      {/* Apply Result */}
      {applyResult && (
        <div className={`p-4 border-t border-plex-border ${
          applyResult.success ? 'bg-green-500/10' : 'bg-red-500/10'
        }`}>
          <div className="flex items-start gap-3">
            {applyResult.success ? (
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            )}
            <div className="flex-1">
              <p className={`font-medium ${applyResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {applyResult.success ? 'Changes Applied Successfully' : 'Apply Failed'}
              </p>

              <div className="mt-2 text-xs space-y-1">
                <p className="text-gray-400">
                  Visibility: {applyResult.visibility_applied} applied, {applyResult.visibility_failed} failed
                </p>
                {applyResult.order_applied && (
                  <p className="text-gray-400">
                    Order: {applyResult.order_verified ? 'Verified' : 'Verification failed'}
                    ({applyResult.reorder_attempts} attempt{applyResult.reorder_attempts !== 1 ? 's' : ''})
                  </p>
                )}
              </div>

              {applyResult.error_messages.length > 0 && (
                <div className="mt-2 p-2 bg-red-500/20 rounded text-xs text-red-400">
                  {applyResult.error_messages.map((msg, i) => (
                    <p key={i}>{msg}</p>
                  ))}
                </div>
              )}

              {applyResult.warnings.length > 0 && (
                <div className="mt-2 p-2 bg-yellow-500/20 rounded text-xs text-yellow-400">
                  {applyResult.warnings.map((msg, i) => (
                    <p key={i}>{msg}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plex-card border border-plex-border rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-2">Confirm Apply</h3>
            <p className="text-gray-400 mb-4">
              This will apply {diff.total_changes} change{diff.total_changes !== 1 ? 's' : ''} to your Plex Home.
              A rollback snapshot will be created automatically.
            </p>

            {diff.has_conflicts && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded">
                <p className="text-sm text-red-400">
                  Warning: There are ordering conflicts that may cause unexpected results.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-plex-dark border border-plex-border rounded
                           hover:bg-plex-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowConfirm(false);
                  await onApply();
                }}
                className="px-4 py-2 bg-plex-gold text-black rounded
                           hover:bg-plex-orange transition-colors"
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
