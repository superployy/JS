FROM node:20-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install dependencies (works without package-lock.json)
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Suppress ytdl-core update check
ENV YTDL_NO_UPDATE=1

# Run the bot
CMD ["node", "index.js"]
