import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

const JotWidget = () => {
  const [highlights, setHighlights] = useState([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('recent');
  const [widgetWidth, setWidgetWidth] = useState(420);
  const [position, setPosition] = useState({ left: 'auto', top: 'auto', right: '20px', bottom: '20px' });
  const [isDragging, setIsDragging] = useState(false);
  
  const containerRef = useRef(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 });
  const resizeTimerRef = useRef(null);
  const fabGuardRef = useRef({ ignoreNextClick: false });

  const WIDGET_WIDTH_MIN = 280;
  const WIDGET_WIDTH_MAX = 640;
  const DEFAULT_WIDGET_WIDTH = 420;

  // Load initial data and listen to storage changes
  useEffect(() => {
    const loadData = () => {
      chrome.storage.local.get(
        ['readmarks', 'readmarkEnabled', 'readmarkWidgetWidth', 'readmarkWidgetPosition', 'readmarkWidgetMinimized'],
        (res) => {
          setHighlights(res.readmarks || []);
          setIsEnabled(res.readmarkEnabled !== false);
          setWidgetWidth(res.readmarkWidgetWidth || DEFAULT_WIDGET_WIDTH);
          
          if (res.readmarkWidgetPosition) {
            setPosition({
              left: `${res.readmarkWidgetPosition.left}px`,
              top: `${res.readmarkWidgetPosition.top}px`,
              right: 'auto',
              bottom: 'auto',
            });
          }
          
          setIsMinimized(res.readmarkWidgetMinimized === true);
        }
      );
    };

    loadData();

    const handleStorageChange = (changes) => {
      if (changes.readmarks) {
        setHighlights(changes.readmarks.newValue || []);
      }
      if (changes.readmarkEnabled) {
        setIsEnabled(changes.readmarkEnabled.newValue !== false);
      }
      if (changes.readmarkWidgetWidth) {
        const w = changes.readmarkWidgetWidth.newValue;
        if (typeof w === 'number' && !Number.isNaN(w)) {
          setWidgetWidth(w);
        }
      }
      if (changes.readmarkWidgetPosition) {
        const pos = changes.readmarkWidgetPosition.newValue;
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
          setPosition({
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            right: 'auto',
            bottom: 'auto',
          });
        }
      }
      if (changes.readmarkWidgetMinimized) {
        setIsMinimized(changes.readmarkWidgetMinimized.newValue === true);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Listen for messages from popup
  useEffect(() => {
    const handleMessage = (msg) => {
      if (msg?.type === 'TOGGLE_READMARK') {
        setIsEnabled(!!msg.enabled);
      }
      if (msg?.type === 'EXPAND_WIDGET') {
        setIsMinimized(false);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const savePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      chrome.storage.local.set({
        readmarkWidgetPosition: { left: Math.round(rect.left), top: Math.round(rect.top) }
      });
    }
  }, []);

  const handleDragStart = (e) => {
    if (e.button !== 0) return;
    const header = e.target.closest('.readmark-header');
    const fab = e.target.closest('.readmark-fab');
    const toggle = e.target.closest('.readmark-toggle');
    
    if (!header && !fab) return;
    if (header && toggle) return;

    dragRef.current.dragging = false;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      dragRef.current.origLeft = rect.left;
      dragRef.current.origTop = rect.top;
    }
  };

  const handleDragMove = useCallback((e) => {
    if (!containerRef.current) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (!dragRef.current.dragging) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      dragRef.current.dragging = true;
      setIsDragging(true);
      document.body.style.userSelect = 'none';
    }

    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const pad = 8;
    const maxL = Math.max(pad, window.innerWidth - w - pad);
    const maxT = Math.max(pad, window.innerHeight - h - pad);
    
    const x = Math.min(maxL, Math.max(pad, dragRef.current.origLeft + dx));
    const y = Math.min(maxT, Math.max(pad, dragRef.current.origTop + dy));

    setPosition({
      left: `${Math.round(x)}px`,
      top: `${Math.round(y)}px`,
      right: 'auto',
      bottom: 'auto',
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragRef.current.dragging) {
      savePosition();
      document.body.style.userSelect = '';
      dragRef.current.dragging = false;
      setIsDragging(false);
    }
  }, [savePosition]);

  useEffect(() => {
    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    window.addEventListener('pointercancel', handleDragEnd);

    return () => {
      window.removeEventListener('pointermove', handleDragMove);
      window.removeEventListener('pointerup', handleDragEnd);
      window.removeEventListener('pointercancel', handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  const handleToggleClick = (e) => {
    e.stopPropagation();
    const newState = !isMinimized;
    setIsMinimized(newState);
    chrome.storage.local.set({ readmarkWidgetMinimized: newState });
  };

  const handleFabClick = (e) => {
    e.stopPropagation();
    if (fabGuardRef.current.ignoreNextClick) {
      fabGuardRef.current.ignoreNextClick = false;
      return;
    }
    if (isMinimized) {
      setIsMinimized(false);
      chrome.storage.local.set({ readmarkWidgetMinimized: false });
    }
  };

  const handleWidthChange = (e) => {
    const w = Math.min(WIDGET_WIDTH_MAX, Math.max(WIDGET_WIDTH_MIN, Math.round(Number(e.target.value))));
    setWidgetWidth(w);
    
    clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      chrome.storage.local.set({ readmarkWidgetWidth: w });
    }, 120);
  };

  const filteredHighlights = searchQuery.trim()
    ? highlights.filter(
        (h) =>
          (h.text || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (h.note || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (h.tags || []).some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : highlights;

  const tagCounts = {};
  highlights.forEach((h) => {
    (h.tags || []).forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const allTags = Object.entries(tagCounts);

  if (!isEnabled) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        zIndex: 999999,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        ...position,
      }}
      onPointerDown={handleDragStart}
    >
      <style>{styles}</style>

      <div className={`readmark-widget ${isMinimized ? 'readmark-minimized' : ''} ${isDragging ? 'readmark-dragging' : ''}`} style={{ '--readmark-panel-width': `${widgetWidth}px` }}>
        <div className="readmark-panel">
          {/* Header */}
          <div className="readmark-header">
            <div className="readmark-title">Jot</div>
            <button
              type="button"
              className="readmark-toggle"
              onClick={handleToggleClick}
              title={isMinimized ? 'Expand' : 'Minimize'}
              aria-expanded={!isMinimized}
            >
              {isMinimized ? '+' : '−'}
            </button>
          </div>

          {/* Content */}
          <div className="readmark-content">
            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                placeholder="Search highlights..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Stats */}
            <div className="readmark-stats">
              <div>
                <div className="readmark-stat-number">{highlights.length}</div>
                <div className="readmark-stat-label">Highlights</div>
              </div>
              <div>
                <div className="readmark-stat-number">{allTags.length}</div>
                <div className="readmark-stat-label">Tags</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="readmark-tabs">
              <button
                className={`readmark-tab ${activeTab === 'recent' ? 'active' : ''}`}
                onClick={() => setActiveTab('recent')}
              >
                Recent
              </button>
              <button
                className={`readmark-tab ${activeTab === 'tags' ? 'active' : ''}`}
                onClick={() => setActiveTab('tags')}
              >
                Tags
              </button>
            </div>

            {/* Highlights List */}
            {activeTab === 'recent' ? (
              filteredHighlights.length === 0 ? (
                <div className="readmark-highlight-item">
                  <div className="readmark-highlight-text">No highlights yet</div>
                </div>
              ) : (
                filteredHighlights.slice().reverse().map((h, idx) => (
                  <div key={idx} className="readmark-highlight-item">
                    <div className="readmark-highlight-text">"{h.text}"</div>
                    {h.note && (
                      <div style={{ marginTop: '6px', fontSize: '12px', color: '#444' }}>
                        {h.note}
                      </div>
                    )}
                    {h.tags && h.tags.length > 0 && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {h.tags.map((tag, tagIdx) => (
                          <span key={tagIdx} className="readmark-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {h.timestamp && (
                      <div style={{ marginTop: '8px', fontSize: '10px', color: '#aaa' }}>
                        {new Date(h.timestamp).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : allTags.length === 0 ? (
              <div className="readmark-highlight-item">
                <div className="readmark-highlight-text">No tags yet</div>
              </div>
            ) : (
              allTags.map(([tag, count], idx) => (
                <div key={idx} className="readmark-highlight-item">
                  <div className="readmark-highlight-text">#{tag}</div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {count} highlight(s)
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* FAB Button */}
        <button
          type="button"
          className="readmark-fab"
          onClick={handleFabClick}
          title={isMinimized ? 'Open Jot' : ''}
          aria-label="Open Jot"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path
              d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

const styles = `
  #readmark-widget-container * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .readmark-widget {
    --readmark-panel-width: 420px;
    position: relative;
    width: var(--readmark-panel-width);
    max-width: min(640px, calc(100vw - 40px));
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.12);
    overflow: hidden;
    border: 1px solid #eaeaea;
    transition:
      width 0.4s cubic-bezier(0.34, 1.15, 0.64, 1),
      height 0.4s cubic-bezier(0.34, 1.15, 0.64, 1),
      border-radius 0.4s cubic-bezier(0.34, 1.15, 0.64, 1),
      box-shadow 0.35s ease,
      min-height 0.4s cubic-bezier(0.34, 1.15, 0.64, 1);
    min-height: 0;
  }

  .readmark-widget.readmark-minimized {
    width: 56px;
    height: 56px;
    min-width: 56px;
    min-height: 56px;
    max-width: 56px;
    border-radius: 50%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    border-color: rgba(0,0,0,0.06);
  }

  .readmark-panel {
    transition:
      opacity 0.32s ease,
      transform 0.42s cubic-bezier(0.34, 1.15, 0.64, 1),
      max-height 0.42s cubic-bezier(0.34, 1.15, 0.64, 1);
    transform-origin: center bottom;
    max-height: min(90vh, 680px);
    opacity: 1;
    transform: scale(1) translateY(0);
  }

  .readmark-widget.readmark-minimized .readmark-panel {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
    max-height: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .readmark-fab {
    pointer-events: none;
    position: absolute;
    inset: 0;
    margin: auto;
    width: 44px;
    height: 44px;
    border: none;
    border-radius: 50%;
    background: #111;
    color: #f6f4f0;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    opacity: 0;
    pointer-events: none;
    transform: scale(0.85);
    transition:
    opacity 0.35s ease 0.08s,
    transform 0.45s cubic-bezier(0.34, 1.15, 0.64, 1) 0.06s,
    background 0.2s ease;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
  }

  .readmark-fab img,
  .readmark-fab svg {
    pointer-events: none;
  }

  .readmark-fab:active {
    cursor: grabbing;
  }

  .readmark-widget.readmark-minimized .readmark-fab {
    opacity: 1;
    pointer-events: auto;
    transform: scale(1);
  }


  .readmark-header {
    background: #111;
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: grab;
    user-select: none;
  }

  .readmark-widget.readmark-dragging .readmark-header {
    cursor: grabbing;
  }

  .readmark-widget.readmark-dragging .readmark-fab {
    cursor: grabbing;
  }

  .readmark-title {
    color: #f6f4f0;
    font-weight: 600;
    font-size: 14px;
  }

  .readmark-toggle {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: #f6f4f0;
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .readmark-toggle:hover {
    background: rgba(255,255,255,0.14);
  }

  .readmark-content {
    padding: 14px;
    max-height: 500px;
    overflow-y: auto;
  }

  .readmark-content::-webkit-scrollbar {
    width: 6px;
  }

  .readmark-content::-webkit-scrollbar-thumb {
    background: #ccc;
    border-radius: 3px;
  }

  .readmark-stats {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
    padding-bottom: 14px;
    border-bottom: 1px solid #eee;
  }

  .readmark-stat-number {
    font-size: 18px;
    font-weight: 700;
    color: #111;
  }

  .readmark-stat-label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
  }

  .readmark-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid #eee;
  }

  .readmark-tab {
    background: none;
    border: none;
    padding: 8px 10px;
    font-size: 13px;
    color: #888;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }

  .readmark-tab.active {
    color: #111;
    border-bottom-color: #111;
  }

  .readmark-highlight-item {
    padding: 12px;
    margin-bottom: 10px;
    background: #fafafa;
    border-left: 2px solid #111;
    border-radius: 8px;
  }

  .readmark-highlight-text {
    color: #111;
    font-style: italic;
  }

  .readmark-tag {
    background: #111;
    color: #f6f4f0;
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 4px;
  }
`;

export function injectJotWidget() {
  const container = document.createElement('div');
  container.id = 'readmark-widget-container';
  container.style.cssText = `
    position: fixed;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    left: auto;
    top: auto;
    right: 20px;
    bottom: 20px;
  `;
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(<JotWidget />);
}

export default JotWidget;