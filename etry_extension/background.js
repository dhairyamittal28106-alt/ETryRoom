// Global Permission Override via Declarative Content
chrome.runtime.onInstalled.addListener(() => {
    // Ensure the action icon is disabled by default
    chrome.action.disable();

    // Clear all existing declarative rules before assigning new ones
    chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
        // Enact the declarativeContent rule for image tags
        // The script matches any page having an <img>, activating the extension icon.
        // The sizing (px) constraint is strictly parsed within content.js' MutationObserver.
        let rule = {
            conditions: [
                new chrome.declarativeContent.PageStateMatcher({
                    pageUrl: { schemes: ['http', 'https'] }
                })
            ],
            actions: [new chrome.declarativeContent.ShowAction()]
        };

        // Apply the new rule to validate the popup access states globally
        chrome.declarativeContent.onPageChanged.addRules([rule]);
        
        console.log("Hardware-Override Synchronizer: declarativeContent Rule Applied. Waiting for image injection...");
    });
});
