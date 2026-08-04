import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import tailwindcss from '@tailwindcss/vite'

const backendProxyTarget = process.env.FANTETIC_DEV_BACKEND_URL || 'http://localhost:3001';
const backendWebSocketProxyTarget = backendProxyTarget.replace(/^http/, 'ws');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // @ts-ignore because the plugin type might not perfectly match Vite's expected PluginOption type
    (monacoEditorPlugin as any).default({})
  ],
  server: {
    port: 22457,
    strictPort: true,
    proxy: {
      // 将所有 /api 开头的请求代理到后端服务器
      '/api': {
        target: backendProxyTarget, // 后端服务器地址
        changeOrigin: false,
        // 可选：如果后端 API 路径没有 /api 前缀，可以在这里重写路径
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      // 将所有 /uploads 开头的请求也代理到后端服务器
      '/uploads': {
        target: backendProxyTarget, // 后端服务器地址
        changeOrigin: false,
        // 通常不需要重写静态资源的路径
      },
      '/ws': {
        target: backendWebSocketProxyTarget, // 后端 WebSocket 服务器地址
        ws: true,
        changeOrigin: false,
      }
    }
  }
})
