import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // [추가] vite preview(도커 frontend 컨테이너)로 /api 요청이 오면 백엔드로 넘긴다
  //   시연 때 VITE_API_URL=/api 로 두면 화면과 API 가 같은 주소를 쓴다
  //   → 터널 1개로 충분, CORS 설정 불필요, 같은 와이파이·핫스팟에서는 http://<PC IP>:5174 만 열면 된다
  //   VITE_API_URL 이 http://... 주소면 이 설정은 쓰이지 않는다. npm run dev 에도 영향 없음
  //   백엔드 주소: 도커 안에서는 서비스 이름 backend:4000 (API_PROXY_TARGET 으로 바꿀 수 있다)
  preview: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://backend:4000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
