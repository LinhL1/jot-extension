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
// OPEN FULL PAGE
// =====================
document.getElementById('open-all').addEventListener('click', function() {
  chrome.storage.local.get(['readmarks'], function(result) {
    const highlights = result.readmarks || [];

    const htmlContent = `
      <html>
      <head>
        <title>ReadMark</title>
      </head>
      <body>
        <h1>All Highlights</h1>
        ${highlights.map(h => `
          <div>
            <p>"${h.text}"</p>
            ${h.note ? `<p>📝 ${h.note}</p>` : ""}
            ${(h.tags || []).map(t => `<span>${t}</span>`).join(' ')}
          </div>
        `).join('')}
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    chrome.tabs.create({ url });
  });
});


// =====================
// IMPORT (FIXED + CLEAN MERGE)
// =====================
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

if (importBtn && importFile) {
  importBtn.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
      try {
        const importedData = JSON.parse(e.target.result);

        if (!Array.isArray(importedData)) {
          throw new Error("Invalid format");
        }

        chrome.storage.local.get(["readmarks"], (result) => {
          const existing = result.readmarks || [];

          const combined = [...existing, ...importedData];

          const unique = combined.filter((item, index, self) =>
            index === self.findIndex(t =>
              t.text === item.text &&
              t.url === item.url &&
              t.timestamp === item.timestamp
            )
          );

          chrome.storage.local.set({ readmarks: unique }, () => {
            alert(`✅ Imported! ${unique.length - existing.length} new notes added.`);
          });
        });

      } catch (err) {
        alert("❌ Invalid JSON file");
      }
    };

    reader.readAsText(file);
  });
}