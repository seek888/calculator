# AppDock「用户自定义构建」形态（部署优先级 1，见 docs/app-deploy-guide.md §1）
# 基础镜像选常见公开镜像（node:22-alpine），依赖走国内 npmmirror
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# 依赖清单单独 COPY，充分利用构建缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmmirror.com

COPY . .

# 运行时契约（§2）：server.js 监听 0.0.0.0:$PORT（缺省 8080），GET / 即探活路径
EXPOSE 8080
CMD ["node", "server.js"]
