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
                            console.log('[Jot/tagger] lastError:', chrome.runtime.lastError.message);
                            resolve(null);
                            return;
                        }
                        console.log('[Jot/tagger] raw response from bg:', response);
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
