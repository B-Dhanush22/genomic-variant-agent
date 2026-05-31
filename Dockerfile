FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY server ./server
COPY public ./public
COPY data ./data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

EXPOSE 4173

CMD ["npm", "start"]

