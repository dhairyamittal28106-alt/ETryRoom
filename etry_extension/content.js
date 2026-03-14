const observer = new MutationObserver(() => {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        // Find clothing-sized images and add the button
        if (img.width > 200 && !img.parentElement.querySelector('.etry-btn')) {
            // Global Permission Override: Signal declarativeContent to enable the extension icon
            document.body.setAttribute('data-etry-active', 'true');
            
            const btn = document.createElement('button');
            btn.innerText = 'Try On (3D)';
            btn.className = 'etry-btn';
            btn.style = "position:absolute; top:10px; left:10px; background:#007bff; color:white; z-index:9999; border-radius:5px; padding:5px;";

            btn.onclick = async (e) => {
                e.preventDefault();
                
                // Permissions-Handshake Automation: Pre-Flight Camera Check
                try {
                    const perm = await navigator.permissions.query({name: 'camera'});
                    if (perm.state !== 'granted') {
                        console.warn("Permissions-Handshake Status: Not Granted. Opening secure localhost origin to enforce native prompt...");
                        // Open a small popup window to the local origin to safely summon the browser's camera prompt
                        const permWindow = window.open("http://127.0.0.1:8000", "ETryRoom_Permissions", "width=400,height=300,left=100,top=100");
                        
                        alert("Please approve the Camera permission pop-up that just opened to link the Shoppers Stop DOM with the RTX 2050 engine!");
                        
                        // Let user accept in new window, close it, then we proceed...
                        // A short timeout before we check if they closed it or continue
                        await new Promise(r => setTimeout(r, 4000));
                        if(permWindow) permWindow.close();
                    } else {
                        console.log("Permissions-Handshake Status: Granted context verified natively.");
                    }
                } catch (err) {
                    console.warn("Permissions API not supported or failed explicitly. Proceeding with caution.", err);
                }

                // Deep-Link Video Handshake: Trigger Auto-Calibration on the RTX 2050 backend
                fetch("http://127.0.0.1:8000/change_category?name=Shirts").catch(e => console.warn("Auto-Calibration API trigger failed"));

                // Inject the live feed from your Victus 15
                // Deep-Link Image Transfer: Send image src automatically to the backend
                const frame = document.createElement('iframe');
                frame.src = `http://127.0.0.1:8000/video_feed?image_url=${encodeURIComponent(img.src)}`;
                frame.allow = "camera; autoplay";
                // Viewport-Scale Correction: portrait ratio ensuring no cutoff
                frame.style = "position:fixed; bottom:20px; right:20px; width:350px; height:500px; z-index:10000; border:2px solid #007bff; border-radius:15px; background:black; object-fit: contain; aspect-ratio: 9/16;";
                document.body.appendChild(frame);
            };
            img.parentElement.style.position = 'relative';
            img.parentElement.appendChild(btn);
        }
    });
});
observer.observe(document.body, { childList: true, subtree: true });