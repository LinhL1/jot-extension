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
// OPEN INTERACTIVE BRAIN VIEW
// =====================
document.getElementById('open-all').addEventListener('click', function() {
  // Open the brain.html page
  chrome.tabs.create({ url: chrome.runtime.getURL('brain.html') });
});

