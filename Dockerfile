# Backend image (Express API + Socket.IO + background jobs). Works on Railway, Render, Fly.io or any Docker host.
# Needs a persistent volume mounted at /data (uploads) and a MySQL database. See DEPLOY.md.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace server --omit=dev
COPY server server
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# apply any new migrations, then start; platform env vars are used (no .env file in the image)
CMD ["sh", "-c", "node server/src/migrate.js && exec node server/src/index.js"]
