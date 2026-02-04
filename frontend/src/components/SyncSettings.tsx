import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Settings,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  Loader2,
  X,
} from 'lucide-react';
import { useSyncSettings } from '../hooks/useApi';
import type { Library, SyncResultStatus, ApplyIfNeededResult } from '../types';

interface SyncSettingsProps {
  library: Library;
  onClose: () => void;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

function getStatusColor(status: SyncResultStatus | null): string {
  switch (status) {
    case 'in_sync':
      return 'text-green-400';
    case 'applied':
      return 'text-blue-400';
    case 'no_active_block':
      return 'text-yellow-400';
    case 'error':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

function getStatusIcon(status: SyncResultStatus | null) {
  switch (status) {
    case 'in_sync':
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    case 'applied':
      return <CheckCircle2 className="w-4 h-4 text-blue-400" />;
    case 'no_active_block':
      return <Pause className="w-4 h-4 text-yellow-400" />;
    case 'error':
      return <XCircle className="w-4 h-4 text-red-400" />;
    default:
      return <AlertCircle className="w-4 h-4 text-gray-400" />;
  }
}

function getStatusLabel(status: SyncResultStatus | null): string {
  switch (status) {
    case 'in_sync':
      return 'In Sync';
    case 'applied':
      return 'Changes Applied';
    case 'no_active_block':
      return 'No Active Block';
    case 'error':
      return 'Error';
    default:
      return 'Not checked';
  }
}

export function SyncSettings({ library, onClose }: SyncSettingsProps) {
  const {
    settings,
    loading,
    error,
    fetchSyncSettings,
    updateSyncSettings,
    syncNow,
  } = useSyncSettings(library.key);

  const [syncResult, setSyncResult] = useState<ApplyIfNeededResult | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchSyncSettings();
  }, [fetchSyncSettings]);

  const handleToggleEnabled = async () => {
    if (!settings) return;
    try {
      await updateSyncSettings({ sync_enabled: !settings.sync_enabled });
    } catch (e) {
      console.error('Failed to toggle sync:', e);
    }
  };

  const handleIntervalChange = async (interval: number) => {
    try {
      await updateSyncSettings({ interval_minutes: interval });
    } catch (e) {
      console.error('Failed to update interval:', e);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncNow();
      setSyncResult(result);
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-plex-dark border border-plex-border rounded-xl w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-plex-border">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-plex-gold" />
            <h2 className="text-lg font-semibold">Sync Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-plex-border rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Library Info */}
          <div className="bg-plex-card border border-plex-border rounded-lg p-3">
            <p className="text-sm text-gray-400">Library</p>
            <p className="font-medium">{library.title}</p>
            <p className="text-xs text-gray-500">Section ID: {library.key}</p>
          </div>

          {loading && !settings ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-plex-gold" />
            </div>
          ) : error ? (
            <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-lg">
              {error}
            </div>
          ) : settings ? (
            <>
              {/* Enable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Auto-Sync Enabled</p>
                  <p className="text-sm text-gray-400">
                    Automatically apply scheduled blocks
                  </p>
                </div>
                <button
                  onClick={handleToggleEnabled}
                  disabled={loading}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    settings.sync_enabled ? 'bg-plex-gold' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.sync_enabled ? 'left-7' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Interval */}
              <div>
                <p className="font-medium mb-2">Check Interval</p>
                <div className="flex flex-wrap gap-2">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleIntervalChange(opt.value)}
                      disabled={loading}
                      className={`px-3 py-1.5 text-sm rounded transition-colors ${
                        settings.interval_minutes === opt.value
                          ? 'bg-plex-gold text-black'
                          : 'bg-plex-card border border-plex-border hover:border-plex-gold'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="bg-plex-card border border-plex-border rounded-lg p-4 space-y-3">
                <p className="text-sm text-gray-400 uppercase tracking-wider">Status</p>

                <div className="flex items-center gap-2">
                  {getStatusIcon(settings.last_result)}
                  <span className={`font-medium ${getStatusColor(settings.last_result)}`}>
                    {getStatusLabel(settings.last_result)}
                  </span>
                </div>

                {settings.last_checked_at && (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Clock className="w-4 h-4" />
                    <span>
                      Last checked: {format(parseISO(settings.last_checked_at), 'MMM d, h:mm:ss a')}
                    </span>
                  </div>
                )}

                {settings.last_applied_at && (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Last applied: {format(parseISO(settings.last_applied_at), 'MMM d, h:mm:ss a')}
                    </span>
                  </div>
                )}

                {settings.last_error && (
                  <div className="text-sm text-red-400 bg-red-500/10 rounded p-2">
                    {settings.last_error}
                  </div>
                )}
              </div>

              {/* Sync Now Button */}
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-plex-gold text-black rounded-lg
                           hover:bg-plex-orange transition-colors disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Sync Now
              </button>

              {/* Sync Result */}
              {syncResult && (
                <div className={`border rounded-lg p-3 ${
                  syncResult.status === 'error'
                    ? 'bg-red-500/10 border-red-500/30'
                    : syncResult.status === 'applied'
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-plex-card border-plex-border'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {getStatusIcon(syncResult.status)}
                    <span className={`font-medium ${getStatusColor(syncResult.status)}`}>
                      {getStatusLabel(syncResult.status)}
                    </span>
                  </div>

                  {syncResult.active_block_name && (
                    <p className="text-sm text-gray-400">
                      Active block: <span className="text-white">{syncResult.active_block_name}</span>
                    </p>
                  )}

                  {syncResult.status === 'applied' && (
                    <p className="text-sm text-gray-400">
                      Applied {syncResult.changes_applied} change{syncResult.changes_applied !== 1 ? 's' : ''}
                      {syncResult.visibility_changes > 0 && ` (${syncResult.visibility_changes} visibility)`}
                      {syncResult.order_changes > 0 && ` (${syncResult.order_changes} order)`}
                    </p>
                  )}

                  {syncResult.error_message && (
                    <p className="text-sm text-red-400 mt-2">{syncResult.error_message}</p>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-plex-border flex justify-end">
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
