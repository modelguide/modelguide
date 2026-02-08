FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_ENV=development npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/.output .output
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
