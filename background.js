// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('ReadMark extension installed!');

  // Initialize storage
  chrome.storage.local.get(['readmarks'], function (result) {
    if (!result.readmarks) {
      chrome.storage.local.set({ readmarks: [] });
    }
  });
});
