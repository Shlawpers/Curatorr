import { useState, useMemo } from 'react';
import { Search, Plus, Filter, Lock } from 'lucide-react';
import type { Collection, CollectionSource } from '../types';

// Helper to detect built-in Plex hubs (can't be deleted, only hidden)
function isBuiltInHub(id: string): boolean {
  // Collections have numeric IDs or start with "custom.collection." or "kometa:"
  // Built-in hubs have IDs like "movie.recentlyadded", "tv.ondeck", etc.
  return !id.startsWith('custom.collection.') &&
         !id.startsWith('kometa:') &&
         isNaN(Number(id));
}

interface Props {
  collections: Collection[];
  onAdd: (collection: Collection) => void;
  homeStackTitles: Set<string>; // Titles already in home stack (for filtering)
}

export function AvailableCollections({ collections, onAdd, homeStackTitles }: Props) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<CollectionSource | 'all'>('all');

  // Filter to collections NOT in home stack (using title matching for consistency)
  const availableCollections = useMemo(() => {
    return collections.filter(c => {
      // Not already in stack (match by title since IDs differ between hubs and collections)
      if (homeStackTitles.has(c.title)) return false;

      // Search filter
      if (search && !c.title.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      // Source filter
      if (sourceFilter !== 'all' && c.source !== sourceFilter) {
        return false;
      }

      return true;
    });
  }, [collections, homeStackTitles, search, sourceFilter]);

  const getSourceBadge = (source: CollectionSource) => {
    switch (source) {
      case 'plex':
        return <span className="text-[10px] px-1 py-0.5 bg-plex-gold/20 text-plex-gold rounded">Plex</span>;
      case 'kometa':
        return <span className="text-[10px] px-1 py-0.5 bg-purple-500/20 text-purple-400 rounded">Kometa</span>;
      case 'both':
        return <span className="text-[10px] px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded">Both</span>;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Available Collections</h2>
        <span className="text-sm text-gray-400">
          {availableCollections.length} available
        </span>
      </div>

      {/* Search and Filter */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
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
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as CollectionSource | 'all')}
          className="px-3 py-2 text-sm bg-plex-dark border border-plex-border rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-plex-gold"
        >
          <option value="all">All Sources</option>
          <option value="plex">Plex</option>
          <option value="kometa">Kometa</option>
          <option value="both">Both</option>
        </select>
      </div>

      {/* Collection Grid */}
      <div className="flex-1 overflow-y-auto">
        {availableCollections.length === 0 && (
          <div key="empty-state" className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Filter className="w-6 h-6 mb-2" />
            <p className="text-sm">
              {search || sourceFilter !== 'all'
                ? 'No collections match filters'
                : 'All collections are on Home'}
            </p>
          </div>
        )}
        {availableCollections.length > 0 && (
          <div key="grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {availableCollections.map(collection => (
              <button
                key={collection.id}
                onClick={() => onAdd(collection)}
                className="flex items-center gap-2 p-2 bg-plex-card border border-plex-border rounded-lg
                           text-left hover:border-plex-gold hover:bg-plex-dark transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{collection.title}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {isBuiltInHub(collection.id) ? (
                      <span className="text-[10px] px-1 py-0.5 bg-orange-500/20 text-orange-400 rounded flex items-center gap-0.5" title="Built-in Plex hub">
                        <Lock className="w-2.5 h-2.5" />
                        Built-in
                      </span>
                    ) : (
                      getSourceBadge(collection.source)
                    )}
                    {collection.child_count > 0 && (
                      <span className="text-[10px] text-gray-500">
                        {collection.child_count} items
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 p-1 rounded bg-plex-gold/0 group-hover:bg-plex-gold/20 transition-colors">
                  <Plus className="w-4 h-4 text-gray-400 group-hover:text-plex-gold" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
