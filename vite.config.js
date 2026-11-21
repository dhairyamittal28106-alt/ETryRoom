import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(root, 'static'),
  base: '/static/',
  publicDir: false,
  plugins: [{
    name: 'copy-pose-assets',
    closeBundle() {
      const output = resolve(root, 'public/static');
      mkdirSync(resolve(output,'parser'),{recursive:true});
      for(const ext of ['mjs','wasm'])cpSync(resolve(root,'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.'+ext),resolve(output,'parser/ort-wasm-simd-threaded.'+(ext==='mjs'?'js':ext)));
      cpSync(resolve(root,'static/garment-parser.onnx'),resolve(output,'parser/garment-parser.onnx'));
      mkdirSync(resolve(output, 'vision-wasm'), { recursive: true });
      cpSync(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm'), resolve(output, 'vision-wasm'), { recursive: true });
      mkdirSync(resolve(output, 'models'), { recursive: true });
      cpSync(resolve(root, 'static/models/pose_landmarker_lite.task'), resolve(output, 'models/pose_landmarker_lite.task'));
    }
  }],
  build: { outDir: resolve(root, 'public/static'), emptyOutDir: true }
});
