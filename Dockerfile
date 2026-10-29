# Image du serveur pour Railway (builder Dockerfile, choisi dans railway.json). Pas de ligne `# syntax=` :
# le frontend BuildKit intégré suffit, sans image à télécharger (c'est le frontend de Railpack qui plantait).

# Build : dépendances de développement comprises (tsc, Vite).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serveur : dépendances de production seulement, le site (dist/) et le serveur (dist-server/).
# PGlite, en dépendance de développement, n'est chargé qu'avec --local.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
CMD ["npm", "start"]
