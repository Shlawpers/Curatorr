import { ChevronDown } from 'lucide-react';
import type { Library } from '../types';

interface Props {
  libraries: Library[];
  selectedLibrary: Library | null;
  onSelect: (library: Library) => void;
  loading: boolean;
}

export function LibrarySelector({ libraries, selectedLibrary, onSelect, loading }: Props) {
  // Filter to movie and show libraries
  const filteredLibraries = libraries.filter(
    lib => lib.type === 'movie' || lib.type === 'show'
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-plex-card border border-plex-border rounded-lg">
        <div className="animate-pulse w-4 h-4 bg-plex-border rounded" />
        <span className="text-gray-400">Loading libraries...</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={selectedLibrary?.key || ''}
        onChange={(e) => {
          const lib = filteredLibraries.find(l => l.key === e.target.value);
          if (lib) onSelect(lib);
        }}
        className="appearance-none w-full px-4 py-2 pr-10 bg-plex-card border border-plex-border rounded-lg
                   text-white focus:outline-none focus:ring-2 focus:ring-plex-gold focus:border-transparent
                   cursor-pointer"
      >
        <option value="">Select Library</option>
        {filteredLibraries.map(lib => (
          <option key={lib.key} value={lib.key}>
            {lib.title}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
        <ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
}
