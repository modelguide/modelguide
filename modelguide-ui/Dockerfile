# ---- deps ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /app/.output ./.output

USER node
EXPOSE 3001
ENV PORT=3001

CMD ["node", ".output/server/index.mjs"]
