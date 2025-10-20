# 1.0.5
# docker build -t taskbot:1.0.5 .
# docker run -d --name taskbot --restart unless-stopped --env-file .env -e TZ=Asia/Bangkok taskbot:1.0.5

# docker build --no-cache -t taskbot:1.0.5 . && docker tag taskbot:1.0.5 199.168.50.160:5000/taskbot:1.0.5 && docker push 199.168.50.160:5000/taskbot:1.0.5

# Dockerfile
FROM node:20-alpine

# ติดตั้ง tzdata ถ้าอยากเซ็ตโซนเวลาให้ถูก
RUN apk add --no-cache tzdata
ENV TZ=Asia/Bangkok \
    NODE_ENV=production

WORKDIR /app

# ติดตั้ง deps
COPY package*.json ./
RUN npm ci --only=production

# คัดลอกซอร์ส
COPY src ./src

# โฟลเดอร์เก็บข้อมูลงาน (ไฟล์ JSON)
RUN mkdir -p /app/data/tasks
# COPY data /app/data

# รันบอท
CMD ["node", "src/bot.js"]