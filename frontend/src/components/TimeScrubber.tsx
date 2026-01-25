import { useState, useEffect } from 'react';
import { Clock, ChevronLeft, ChevronRight, Calendar, RotateCcw } from 'lucide-react';
import { format, addDays, addHours, startOfDay, isToday } from 'date-fns';

interface Props {
  value: Date;
  onChange: (date: Date) => void;
  nextChanges: string[];
  onJumpToChange: (date: Date) => void;
}

export function TimeScrubber({ value, onChange, nextChanges, onJumpToChange }: Props) {
  const [isLive, setIsLive] = useState(true);

  // Update to current time when in live mode
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      onChange(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [isLive, onChange]);

  const handleDateChange = (newDate: Date) => {
    setIsLive(false);
    onChange(newDate);
  };

  const handleNow = () => {
    setIsLive(true);
    onChange(new Date());
  };

  const handleQuickJump = (amount: number, unit: 'hours' | 'days') => {
    setIsLive(false);
    const newDate = unit === 'hours'
      ? addHours(value, amount)
      : addDays(value, amount);
    onChange(newDate);
  };

  const handleNextWeekend = () => {
    setIsLive(false);
    // Find next Friday 6pm
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
    const friday = addDays(startOfDay(today), daysUntilFriday);
    friday.setHours(18, 0, 0, 0);
    onChange(friday);
  };

  const formatNextChange = (isoString: string) => {
    const date = new Date(isoString);
    if (isToday(date)) {
      return `Today ${format(date, 'h:mm a')}`;
    }
    return format(date, 'EEE MMM d, h:mm a');
  };

  return (
    <div className="bg-plex-card border border-plex-border rounded-lg p-4">
      {/* Current Time Display */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-plex-gold" />
          <span className="text-lg font-semibold">
            Preview @ {format(value, 'EEE MMM d, yyyy h:mm a')}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>

        <button
          onClick={handleNow}
          disabled={isLive}
          className="flex items-center gap-1 px-3 py-1.5 bg-plex-dark border border-plex-border rounded
                     text-sm hover:bg-plex-border disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Now
        </button>
      </div>

      {/* Time Navigation */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => handleQuickJump(-1, 'days')}
          className="p-2 bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
          title="Previous Day"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 flex items-center justify-center gap-2">
          <button
            onClick={() => handleQuickJump(-6, 'hours')}
            className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
          >
            -6h
          </button>
          <button
            onClick={() => handleQuickJump(-1, 'hours')}
            className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
          >
            -1h
          </button>

          <div className="relative">
            <input
              type="datetime-local"
              value={format(value, "yyyy-MM-dd'T'HH:mm")}
              onChange={(e) => {
                const newDate = new Date(e.target.value);
                if (!isNaN(newDate.getTime())) {
                  handleDateChange(newDate);
                }
              }}
              className="px-3 py-1.5 bg-plex-dark border border-plex-border rounded text-sm
                         focus:outline-none focus:ring-2 focus:ring-plex-gold"
            />
          </div>

          <button
            onClick={() => handleQuickJump(1, 'hours')}
            className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
          >
            +1h
          </button>
          <button
            onClick={() => handleQuickJump(6, 'hours')}
            className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
          >
            +6h
          </button>
        </div>

        <button
          onClick={() => handleQuickJump(1, 'days')}
          className="p-2 bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
          title="Next Day"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Jump Buttons */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Quick:</span>
        <button
          onClick={handleNextWeekend}
          className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
        >
          Next Weekend
        </button>
        <button
          onClick={() => handleQuickJump(7, 'days')}
          className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
        >
          +1 Week
        </button>
        <button
          onClick={() => handleQuickJump(30, 'days')}
          className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded hover:bg-plex-border transition-colors"
        >
          +1 Month
        </button>
      </div>

      {/* Next Changes */}
      {nextChanges.length > 0 && (
        <div className="border-t border-plex-border pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-400">Upcoming Changes</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {nextChanges.slice(0, 5).map((change) => (
              <button
                key={change}
                onClick={() => onJumpToChange(new Date(change))}
                className="px-2 py-1 text-xs bg-plex-dark border border-plex-border rounded
                           hover:bg-plex-gold/20 hover:border-plex-gold hover:text-plex-gold
                           transition-colors"
              >
                {formatNextChange(change)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
