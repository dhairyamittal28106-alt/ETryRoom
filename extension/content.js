// Autonomous Observer for Product Images

function injectTryOnButton(img) {
  // Prevent duplicate injections
  if (img.dataset.etryOverlayInjected) return;
  img.dataset.etryOverlayInjected = "true";

  // Ensure image has a non-static position for relative overlay
  const rect = img.getBoundingClientRect();
  if (rect.width < 150 || rect.height < 150) return; // Skip small icons

  const wrapper = document.createElement("div");
  wrapper.className = "etry-wrapper";
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  // Dynamically inject Feature Policy Bridge
  wrapper.setAttribute("allow", "camera; microphone; autoplay; encrypted-media");
  
  // Wrap the image
  img.parentNode.insertBefore(wrapper, img);
  wrapper.appendChild(img);

  // Create Try On Button
  const btn = document.createElement("button");
  btn.innerText = "👗 Try On (3D)";
  btn.className = "etry-button";
  wrapper.appendChild(btn);

  // Setup click handler
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    btn.style.display = "none";
    
    // Headless Handshake logic
    await checkAndRequestCameraPermissions(wrapper);
    
    initiate3DOverlay(wrapper, img);
  });
}

async function checkAndRequestCameraPermissions(wrapper) {
  try {
    let needsPermission = false;
    
    // Check via Permissions API if available
    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: 'camera' });
      if (status.state === 'prompt' || status.state === 'denied') {
        needsPermission = true;
      }
    } else {
      // Fallback: verify status via enumerateDevices 
      // Devices without labels usually mean permission hasn't been granted
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (videoDevices.length > 0 && videoDevices[0].label === "") {
        needsPermission = true; // Prompt if label is restricted
      }
    }

    if (needsPermission) {
      console.log("ETryRoom: Headless Handshake - Triggering Shadow DOM Permission Request...");
      // Trigger a Shadow DOM Permission Request
      const shadowHost = document.createElement("div");
      wrapper.appendChild(shadowHost);
      const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
      
      const iframe = document.createElement('iframe');
      // Adding allow attribute to iframe inside shadow DOM to bypass top-level blocks
      iframe.setAttribute("allow", "camera; microphone; autoplay; encrypted-media");
      iframe.style.display = "none";
      shadowRoot.appendChild(iframe);

      try {
        // Attempt to prompt for camera access
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (err) {
        console.warn("ETryRoom: Shadow DOM Permission Request blocked or denied.", err);
      }
    }
  } catch (err) {
    console.error("ETryRoom: Permission handshake failed:", err);
  }
}

function initiate3DOverlay(wrapper, img) {
  // Execute Deep-Link Synchronization to trigger Engine3D init on CUDA and the Y-axis work pulse
  fetch("http://localhost:8000/change_category?name=Shirts").catch(err => {
      console.warn("ETryRoom: Deep-Link Synchronization to backend failed:", err);
  });

  // Create an Offscreen Canvas for high-performance rendering
  const canvas = document.createElement("canvas");
  canvas.width = img.clientWidth;
  canvas.height = img.clientHeight;
  canvas.className = "etry-canvas";
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none"; // Let clicks pass through to the image
  wrapper.appendChild(canvas);

  try {
    const offscreen = canvas.transferControlToOffscreen();
    
    // Launch Web Worker to handle the WebSocket and rendering on the Offscreen Canvas
    const workerUrl = chrome.runtime.getURL("worker.js");
    const worker = new Worker(workerUrl);
    
    worker.postMessage({
      action: "START_PHYSICS",
      canvas: offscreen,
      width: canvas.width,
      height: canvas.height
    }, [offscreen]);

  } catch (err) {
    console.error("ETryRoom: OffscreenCanvas error:", err);
  }
}

// -----------------------------------------
// DOM SCANNER: Observe DOM for large images
// -----------------------------------------
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      const imgs = document.querySelectorAll("img");
      imgs.forEach((img) => {
        if (img.complete) {
            injectTryOnButton(img);
        } else {
            // Note: only attach onload once if not complete
            if (!img.dataset.etryOnloadAttached) {
                img.dataset.etryOnloadAttached = "true";
                img.addEventListener("load", () => injectTryOnButton(img));
            }
        }
      });
    }
  });
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan
window.onload = () => {
    const imgs = document.querySelectorAll("img");
    imgs.forEach(img => {
        if (img.complete) {
            injectTryOnButton(img);
        } else {
            if (!img.dataset.etryOnloadAttached) {
                img.dataset.etryOnloadAttached = "true";
                img.addEventListener("load", () => injectTryOnButton(img));
            }
        }
    });
};
