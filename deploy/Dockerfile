# =============================================================================
# XiaoMan Mall — optional production image
#
# WHAT THIS FILE IS
#   A small, dependency-free image for the XiaoMan Mall Node.js server. It
#   copies only runtime code, seeds the two catalog JSON files, runs as an
#   unprivileged user, and checks /api/health.
#
# 这个文件是干什么的
#   小满商城的可选 Docker 镜像：只带运行时代码、预置商品/分类 JSON、
#   用非 root 用户启动、带健康检查，数据放在 /app/data 卷里。
#
# 构建（在仓库根目录执行，构建上下文必须是仓库根）
#   docker build -f deploy/Dockerfile -t xiaoman-mall:1.0.0 .
#
# 运行
#   docker run -d --name xiaoman-mall \
#     -p 127.0.0.1:3000:3000 \
#     -v xiaoman-mall-data:/app/data \
#     -e AGENT_MODE=local \
#     xiaoman-mall:1.0.0
#
# 注意
#   - 基础镜像按要求用 node:22-alpine；生产机直装建议 Node 24，两者都满足
#     package.json 的 >=18。正式环境请把 22 换成你验证过的具体小版本（如 22.14-alpine）。
#   - server/data 里可能有用户、会话、订单，绝对不能 COPY 进镜像层；
#     这里只单独复制商品和分类两个种子文件。
#   - 构建上下文仍会把这些文件发给 Docker daemon。远程构建机/CI 上构建时，
#     先在一个干净目录里 git archive 再构建，避免无关数据外发。
# =============================================================================

FROM node:22-alpine

# 只用内置模块，不需要 npm install；关闭 npm 更新检查，减少启动噪音。
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    HOST=0.0.0.0 \
    PORT=3000 \
    XM_DATA_DIR=/app/data \
    XM_TRACE_FILE=/app/data/agent-traces.jsonl

WORKDIR /app

# 代码只读，属主 root；运行时用户只写 /app/data。
COPY package.json ./
COPY server/index-服务入口.js server/router-迷你路由.js ./server/
COPY server/agent ./server/agent
COPY server/lib ./server/lib
COPY server/routes ./server/routes
COPY server/services ./server/services
COPY public ./public

# 建非 root 用户（固定 uid/gid，方便宿主机卷对权限）。
RUN addgroup -S -g 10001 xiaoman \
    && adduser -S -D -H -u 10001 -G xiaoman -h /app -s /sbin/nologin xiaoman

# 只把商品/分类种进数据目录，其它运行时 JSON 由程序首次写入时创建。
# 这里用 COPY 精确挑两个文件，不复制整个 server/data，
# 避免把用户、会话、订单带进镜像层。
RUN mkdir -p /app/data
COPY ["server/data/products-商品数据.json", "server/data/categories-商品分类.json", "/app/data/"]
RUN chown -R xiaoman:xiaoman /app/data \
    && chmod 750 /app/data

USER xiaoman

# 命名卷挂这里；compose 会把 mall-data 映射到 /app/data。
VOLUME ["/app/data"]

EXPOSE 3000

# /api/health 由 server/index-服务入口.js 直接处理，不读数据文件。
# 用 Node 内置 fetch，不额外装 curl/wget。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', { signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(j => process.exit(j && j.data && j.data.status === 'ok' ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM

# exec 形式：Node 是 PID 1，能直接收到 SIGTERM，走应用自己的优雅退出。
CMD ["node", "server/index-服务入口.js"]