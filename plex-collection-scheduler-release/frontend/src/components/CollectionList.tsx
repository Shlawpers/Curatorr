import { useState, useMemo } from 'react';
import { Search, Filter, Sparkles, Clock, Eye, AlertTriangle, Layers } from 'lucide-react';
import type { Collection, ScheduleStatus, CollectionSource } from '../types';

interface Props {
  collections: Collection[];
  selectedId: string | null;
  onSelect: (collection: Collection) => void;
  loading: boolean;
}

export function CollectionList({ collections, selectedId, onSelect, loading }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ScheduleStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<CollectionSource | 'all'>('all');

  const filteredCollections = useMemo(() => {
    return collections.filter(c => {
      // Search filter
      if (search && !c.title.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      // Status filter
      if (statusFilter !== 'all' && c.status !== statusFilter) {
        return false;
      }
      // Source filter
      if (sourceFilter !== 'all' && c.source !== sourceFilter) {
        return false;
      }
      return true;
    });
  }, [collections, search, statusFilter, sourceFilter]);

  const getStatusIcon = (status: ScheduleStatus) => {
    switch (status) {
      case 'active':
        return <Eye className="w-3 h-3 text-green-400" />;
      case 'scheduled':
        return <Clock className="w-3 h-3 text-yellow-400" />;
      case 'kometa_only':
        return <Sparkles className="w-3 h-3 text-purple-400" />;
      case 'conflict':
        return <AlertTriangle className="w-3 h-3 text-red-400" />;
      default:
        return <Layers className="w-3 h-3 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: ScheduleStatus) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-active">Active</span>;
      case 'scheduled':
        return <span className="badge badge-scheduled">Scheduled</span>;
      case 'kometa_only':
        return <span className="badge badge-kometa">Kometa</span>;
      case 'conflict':
        return <span className="badge bg-red-500/20 text-red-400">Conflict</span>;
      default:
        return <span className="badge bg-gray-500/20 text-gray-400">Manual</span>;
    }
  };

  const getSourceBadge = (source: CollectionSource) => {
    switch (source) {
      case 'plex':
        return <span className="badge badge-plex">Plex</span>;
      case 'kometa':
        return <span className="badge badge-kometa">Kometa</span>;
      case 'both':
        return <span className="badge badge-both">Both</span>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="animate-pulse h-16 bg-plex-card border border-plex-border rounded-lg"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search collections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-plex-dark border border-plex-border rounded-lg
                     text-sm focus:outline-none focus:ring-2 focus:ring-plex-gold"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ScheduleStatus | 'all')}
          className="flex-1 px-2 py-1.5 text-xs bg-plex-dark border border-plex-border rounded
                     focus:outline-none focus:ring-2 focus:ring-plex-gold"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="scheduled">Scheduled</option>
          <option value="manual">Manual</option>
          <option value="kometa_only">Kometa Only</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as CollectionSource | 'all')}
          className="flex-1 px-2 py-1.5 text-xs bg-plex-dark border border-plex-border rounded
                     focus:outline-none focus:ring-2 focus:ring-plex-gold"
        >
          <option value="all">All Sources</option>
          <option value="plex">Plex</option>
          <option value="kometa">Kometa</option>
          <option value="both">Both</option>
        </select>
      </div>

      {/* Count */}
      <div className="text-xs text-gray-500 mb-2">
        {filteredCollections.length} of {collections.length} collections
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {filteredCollections.map(collection => (
          <button
            key={collection.id}
            onClick={() => onSelect(collection)}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              selectedId === collection.id
                ? 'bg-plex-gold/10 border-plex-gold'
                : 'bg-plex-card border-plex-border hover:bg-plex-dark hover:border-plex-gold/50'
            }`}
          >
            <div className="flex items-start gap-2">
              {getStatusIcon(collection.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-sm">{collection.title}</p>
                <div className="flex items-center gap-1 mt-1">
                  {getSourceBadge(collection.source)}
                  {getStatusBadge(collection.status)}
                </div>
                {collection.windows_count > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    {collection.windows_count} window{collection.windows_count !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              {collection.child_count > 0 && (
                <span className="text-xs text-gray-500">
                  {collection.child_count} items
                </span>
              )}
            </div>
          </button>
        ))}

        {filteredCollections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <Filter className="w-8 h-8 mb-2" />
            <p className="text-sm">No collections match filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
