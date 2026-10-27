
chrome.runtime.onInstalled.addListener(() => {
    
    chrome.action.disable();

    
    chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
        
        
        
        let rule = {
            conditions: [
                new chrome.declarativeContent.PageStateMatcher({
                    pageUrl: { schemes: ['http', 'https'] }
                })
            ],
            actions: [new chrome.declarativeContent.ShowAction()]
        };

        
        chrome.declarativeContent.onPageChanged.addRules([rule]);
        
        console.log("Hardware-Override Synchronizer: declarativeContent Rule Applied. Waiting for image injection...");
    });
});
