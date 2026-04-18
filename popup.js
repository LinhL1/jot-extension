// =====================
// LOAD STATS
// =====================
chrome.storage.local.get(['readmarks'], function(result) {
  const highlights = result.readmarks || [];

  document.getElementById('stat-highlights').textContent = highlights.length;

  const allTags = new Set();
  highlights.forEach(h => {
    if (h.tags) {
      h.tags.forEach(tag => allTags.add(tag));
    }
  });

  document.getElementById('stat-tags').textContent = allTags.size;
});


// =====================
// EXPORT
// =====================
document.getElementById('export-btn').addEventListener('click', function() {
  chrome.storage.local.get(['readmarks'], function(result) {
    const highlights = result.readmarks || [];

    const dataStr = JSON.stringify(highlights, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const fileName = `readmarks-${new Date().toISOString().split('T')[0]}.json`;

    const link = document.createElement('a');
    link.href = dataUri;
    link.download = fileName;
    link.click();
  });
});


// =====================
// TOGGLE HIGHLIGHTING
// =====================
const toggleBtn = document.getElementById("toggle-btn");

chrome.storage.local.get(["readmarkEnabled"], (res) => {
  const enabled = res.readmarkEnabled ?? true;
  updateToggleUI(enabled);
});

toggleBtn.addEventListener("click", () => {
  chrome.storage.local.get(["readmarkEnabled"], (res) => {
    const newState = !(res.readmarkEnabled ?? true);

    chrome.storage.local.set({ readmarkEnabled: newState }, () => {
      updateToggleUI(newState);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "TOGGLE_READMARK",
          enabled: newState
        });
      });
    });
  });
});

function updateToggleUI(enabled) {
  toggleBtn.textContent = enabled
    ? "Disable Highlighting"
    : "Enable Highlighting";

  toggleBtn.style.background = enabled ? "rgba(255,255,255,0.25)" : "#ff4d4d";
}


// =====================
// OPEN FULL PAGE (WITH IMPROVED STYLING)
// =====================
document.getElementById('open-all').addEventListener('click', function() {
  chrome.storage.local.get(['readmarks'], function(result) {
    const highlights = result.readmarks || [];

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Jot - All Highlights</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }
          body {
            background: #f6f4f0;
            color: #111;
            padding: 24px;
            max-width: 1000px;
            margin: 0 auto;
          }
          header {
            margin-bottom: 32px;
            padding-bottom: 16px;
            border-bottom: 1px solid #e5e5e5;
          }
          h1 {
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #1a1a1a;
          }
          .subtitle {
            color: #666;
            font-size: 14px;
          }
          .highlight-count {
            margin-top: 8px;
            font-size: 14px;
            color: #888;
          }
          .highlight-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
          }
          .highlight-card {
            background: #fff;
            border: 1px solid #e5e5e5;
            border-radius: 12px;
            padding: 20px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          }
          .highlight-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.08);
          }
          .highlight-text {
            font-style: italic;
            font-size: 15px;
            line-height: 1.5;
            color: #111;
            margin-bottom: 12px;
            padding: 0 4px;
          }
          .highlight-note {
            background: #f9f9f9;
            border-left: 3px solid #ddd;
            padding: 12px 16px;
            margin: 12px 0;
            font-size: 14px;
            line-height: 1.5;
            color: #555;
            border-radius: 0 4px 4px 0;
          }
          .highlight-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 12px 0 8px 0;
          }
          .tag {
            background: #f0f0f0;
            border: 1px solid #e0e0e0;
            color: #555;
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 4px;
          }
          .highlight-meta {
            font-size: 12px;
            color: #888;
            margin-top: 8px;
            border-top: 1px solid #f0f0f0;
            padding-top: 8px;
          }
          .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #999;
            font-size: 16px;
          }
          @media (max-width: 768px) {
            body {
              padding: 16px;
            }
            .highlight-grid {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>Jot Highlights</h1>
          <div class="subtitle">All your saved notes and highlights</div>
          <div class="highlight-count">${highlights.length} ${highlights.length === 1 ? 'highlight' : 'highlights'}</div>
        </header>
        
        ${highlights.length > 0 ? `
          <div class="highlight-grid">
            ${highlights.map(h => `
              <div class="highlight-card">
                <div class="highlight-text">"${h.text}"</div>
                ${h.note ? `<div class="highlight-note">${h.note}</div>` : ""}
                ${h.tags && h.tags.length ? `
                  <div class="highlight-tags">
                    ${h.tags.map(t => `<span class="tag">#${t}</span>`).join('')}
                  </div>
                ` : ''}
                <div class="highlight-meta">
                  ${h.url ? `<div>From: ${new URL(h.url).hostname}</div>` : ''}
                  ${h.timestamp ? `<div>Saved: ${new Date(h.timestamp).toLocaleString()}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state">
            No highlights yet. Select text on any page to start collecting highlights.
          </div>
        `}
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    chrome.tabs.create({ url });
  });
});
