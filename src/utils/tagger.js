// Gemini tagging utility — transport layer only.
// Relays note text to the background service worker, which owns the fetch call.
// Returns Promise<{ category, tags } | null>; never throws.
(function () {
    'use strict';

    function generateNoteTags(text) {
        return new Promise(function (resolve) {
            try {
                chrome.runtime.sendMessage(
                    { type: 'GENERATE_TAGS', text: text },
                    function (response) {
                        if (chrome.runtime.lastError) {
                            void chrome.runtime.lastError;
                            resolve(null);
                            return;
                        }
                        resolve(response || null);
                    }
                );
            } catch (e) {
                resolve(null);
            }
        });
    }

    window.JotTagger = { generateNoteTags: generateNoteTags };
}());
