FROM node:22-alpine

WORKDIR /app

# Install dependencies inside the image
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy scripts
COPY build/ ./

ENTRYPOINT ["node"]
