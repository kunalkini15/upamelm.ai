FROM node:22-bookworm-slim
WORKDIR /app
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
EXPOSE 5175
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5175"]

