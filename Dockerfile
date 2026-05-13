# 2.0.0
# docker build -t taskbot:2.0.0 .
# docker run -d --name taskbot --restart unless-stopped --env-file .env -e TZ=Asia/Bangkok taskbot:2.0.0
# docker build --no-cache -t taskbot:2.0.0 . && docker tag taskbot:2.0.0 199.168.50.160:5000/taskbot:2.0.0 && docker push 199.168.50.160:5000/taskbot:2.0.0

#
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Bangkok

RUN apk add --no-cache tzdata

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

CMD ["node", "dist/index.js"]