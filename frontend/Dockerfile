FROM node:22-bookworm-slim

WORKDIR /app/frontend

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

EXPOSE 3000
CMD ["npm", "run", "dev"]
