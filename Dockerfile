FROM node:20-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Optional: suppress ytdl-core update check
ENV YTDL_NO_UPDATE=1

CMD ["node", "index.js"]
