let canvas;
let ctx;
let width, height;
let ws;

// Simple orthographic projection for the shirt vertices
function renderPoints(verticesFloat32) {
    if (!ctx) return;
    
    // Clear the canvas each frame
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255, 0, 127, 0.6)"; // Neon pink vertices
    
    // The physics driver sends an array of vertices [x, y, z, x, y, z...]
    // 6890 vertices * 3 floats = 20670 floats
    const numVerts = verticesFloat32.length / 3;
    
    ctx.beginPath();
    
    // Centering and scaling purely based on canvas size
    const scale = Math.min(width, height) * 0.4;
    const cx = width / 2;
    const cy = height / 2;

    for (let i = 0; i < numVerts; i++) {
        // We only care about X and Y for a simple orthographic overlay
        const x = verticesFloat32[i * 3];
        const y = verticesFloat32[i * 3 + 1];
        // Note: Z is at i * 3 + 2, but we ignore it for 2D context plotting
        
        // Map 3D space to 2D canvas space (flip Y because canvas Y is down)
        const px = cx + (x * scale);
        const py = cy - (y * scale);

        ctx.rect(px, py, 1.5, 1.5);
    }
    
    ctx.fill();
}

self.onmessage = (e) => {
    const data = e.data;
    if (data.action === "START_PHYSICS") {
        canvas = data.canvas;
        width = data.width;
        height = data.height;
        ctx = canvas.getContext("2d");

        // Connect to FastAPI WebSocket
        ws = new WebSocket("ws://localhost:8000/ws/physics");
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
            console.log("ETryRoom Worker: Connected to Physics Driver (60 FPS)");
        };

        ws.onmessage = (event) => {
            // Receive binary float32 array natively from Python
            if (event.data instanceof ArrayBuffer) {
                const verticesFloat32 = new Float32Array(event.data);
                
                // Request animation frame is supported in OffscreenCanvas workers!
                self.requestAnimationFrame(() => renderPoints(verticesFloat32));
            }
        };

        ws.onerror = (err) => {
            console.error("ETryRoom Worker WS Error:", err);
            // Draw an error message
            ctx.fillStyle = "red";
            ctx.font = "20px Arial";
            ctx.fillText("Failed to connect to local 3D engine", 20, 40);
        };

        ws.onclose = () => {
            console.log("ETryRoom Worker WS Closed");
        };
    }
};
