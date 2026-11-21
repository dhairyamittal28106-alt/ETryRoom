let canvas;
let ctx;
let width, height;
let ws;


function renderPoints(verticesFloat32) {
    if (!ctx) return;
    
    
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255, 0, 127, 0.6)"; 
    
    
    
    const numVerts = verticesFloat32.length / 3;
    
    ctx.beginPath();
    
    
    const scale = Math.min(width, height) * 0.4;
    const cx = width / 2;
    const cy = height / 2;

    for (let i = 0; i < numVerts; i++) {
        
        const x = verticesFloat32[i * 3];
        const y = verticesFloat32[i * 3 + 1];
        
        
        
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

        
        ws = new WebSocket("ws://localhost:8000/ws/physics");
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
            console.log("ETryRoom Worker: Connected to Physics Driver (60 FPS)");
        };

        ws.onmessage = (event) => {
            
            if (event.data instanceof ArrayBuffer) {
                const verticesFloat32 = new Float32Array(event.data);
                
                
                self.requestAnimationFrame(() => renderPoints(verticesFloat32));
            }
        };

        ws.onerror = (err) => {
            console.error("ETryRoom Worker WS Error:", err);
            
            ctx.fillStyle = "red";
            ctx.font = "20px Arial";
            ctx.fillText("Failed to connect to local 3D engine", 20, 40);
        };

        ws.onclose = () => {
            console.log("ETryRoom Worker WS Closed");
        };
    }
};
