import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// [추가] 백엔드 주소: 화면은 항상 /api 로 요청하고, 이 서버가 백엔드로 넘겨준다 (proxy)
//   → 노트북(localhost), 같은 와이파이의 휴대폰(노트북 IP), 터널 주소(https://….trycloudflare.com) 어디서 열어도
//     화면과 백엔드가 같은 주소라서 그대로 동작한다 (CORS 설정도 필요 없음)
//   Docker 안에서는 docker-compose.yml 의 VITE_PROXY_TARGET=http://backend:4000 을 쓰고,
//   노트북에서 npm run dev 로 직접 띄우면 기본값 http://localhost:4000
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:4000'

const apiProxy = {
  '/api': {
    target: PROXY_TARGET,
    changeOrigin: true,
    // /api/recommend → 백엔드의 /recommend
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
}

// [추가] 바깥 주소로 열 때 Vite 가 막지 않도록 허용할 호스트 (IP 주소·localhost 는 원래 허용)
//   Cloudflare 빠른 터널(…trycloudflare.com), ngrok(…ngrok-free.app)
const allowedHosts = ['.trycloudflare.com', '.ngrok-free.app']

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

  // 개발 서버 (지금 Docker 가 쓰는 것) / 빌드 미리보기 서버 모두 같은 규칙
  server: { proxy: apiProxy, allowedHosts },
  preview: { proxy: apiProxy, allowedHosts },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
