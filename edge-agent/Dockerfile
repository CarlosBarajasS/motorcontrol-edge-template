FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY services ./services

EXPOSE 8090
CMD ["npm", "start"]
