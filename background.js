// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('ReadMark extension installed!');
  
  // Initialize storage
  chrome.storage.local.get(['readmarks'], function(result) {
    if (!result.readmarks) {
      chrome.storage.local.set({ readmarks: [] });
    }
  });
});

// Inject content script into all tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(() => {
      // Silently fail for tabs where scripts can't be injected (e.g., chrome://)
    });
  }
});