const observer = new MutationObserver(() => {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        
        if (img.width > 200 && !img.parentElement.querySelector('.etry-btn')) {
            
            document.body.setAttribute('data-etry-active', 'true');
            
            const btn = document.createElement('button');
            btn.innerText = 'Try On (3D)';
            btn.className = 'etry-btn';
            btn.style = "position:absolute; top:10px; left:10px; background:#007bff; color:white; z-index:9999; border-radius:5px; padding:5px;";

            btn.onclick = async (e) => {
                e.preventDefault();
                
                
                try {
                    const perm = await navigator.permissions.query({name: 'camera'});
                    if (perm.state !== 'granted') {
                        console.warn("Permissions-Handshake Status: Not Granted. Opening secure localhost origin to enforce native prompt...");
                        
                        const permWindow = window.open("http://127.0.0.1:8000", "ETryRoom_Permissions", "width=400,height=300,left=100,top=100");
                        
                        alert("Please approve the Camera permission pop-up that just opened to link the Shoppers Stop DOM with the RTX 2050 engine!");
                        
                        
                        
                        await new Promise(r => setTimeout(r, 4000));
                        if(permWindow) permWindow.close();
                    } else {
                        console.log("Permissions-Handshake Status: Granted context verified natively.");
                    }
                } catch (err) {
                    console.warn("Permissions API not supported or failed explicitly. Proceeding with caution.", err);
                }

                
                fetch("http://127.0.0.1:8000/change_category?name=Shirts").catch(e => console.warn("Auto-Calibration API trigger failed"));

                
                const host = document.createElement('div');
                host.style = "position:fixed; bottom:20px; right:20px; width:350px; height:500px; z-index:10000; border:2px solid #007bff; border-radius:15px; background:black; overflow:hidden;";
                document.body.appendChild(host);

                const shadow = host.attachShadow({mode: 'closed'});
                const canvas = document.createElement('canvas');
                canvas.width = 480;
                canvas.height = 640;
                
                canvas.style = "width:100%; height:100%; object-fit: contain; aspect-ratio: 9/16;";
                shadow.appendChild(canvas);

                const ctx = canvas.getContext('2d');
                let feedImg = new Image();
                
                let isDrawing = false;
                const drawLoop = () => {
                    if (isDrawing && feedImg.complete && feedImg.naturalWidth > 0) {
                        ctx.drawImage(feedImg, 0, 0, canvas.width, canvas.height);
                    }
                    requestAnimationFrame(drawLoop);
                };
                requestAnimationFrame(drawLoop);

                
                
                const sendTextureBase64 = async (imgSrc) => {
                    try {
                        const resp = await fetch(imgSrc);
                        const blob = await resp.blob();
                        const reader = new FileReader();
                        reader.onloadend = async () => {
                            const b64 = reader.result; 
                            await fetch('http://127.0.0.1:8000/upload_texture', {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({ image_data: b64 })
                            }).catch(e => console.warn('Base64-to-CUDA POST failed, falling back to URL query', e));
                        };
                        reader.readAsDataURL(blob);
                    } catch (e) {
                        console.warn('Base64 capture failed, falling back to URL query param', e);
                    }
                };
                sendTextureBase64(img.src);

                
                fetch(`http://127.0.0.1:8000/video_feed`)
                    .then(response => {
                        const reader = response.body.getReader();
                        let buffer = new Uint8Array();

                        const readStream = async () => {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                const newBuffer = new Uint8Array(buffer.length + value.length);
                                newBuffer.set(buffer);
                                newBuffer.set(value, buffer.length);
                                buffer = newBuffer;

                                
                                const start = buffer.findIndex((_, i) => buffer[i] === 0xFF && buffer[i+1] === 0xD8);
                                const end = buffer.findIndex((_, i) => buffer[i] === 0xFF && buffer[i+1] === 0xD9);

                                if (start !== -1 && end !== -1 && end > start) {
                                    const jpegData = buffer.slice(start, end + 2);
                                    buffer = buffer.slice(end + 2); 

                                    const blob = new Blob([jpegData], { type: 'image/jpeg' });
                                    const url = URL.createObjectURL(blob);
                                    
                                    const nextImg = new Image();
                                    nextImg.onload = () => {
                                        feedImg = nextImg;
                                        isDrawing = true;
                                        URL.revokeObjectURL(url);
                                    };
                                    nextImg.src = url;
                                }
                            }
                        };
                        readStream();
                    })
                    .catch(e => console.error("Cross-Origin Pixel Stream Error: ", e));
            };
            img.parentElement.style.position = 'relative';
            img.parentElement.appendChild(btn);
        }
    });
});
observer.observe(document.body, { childList: true, subtree: true });