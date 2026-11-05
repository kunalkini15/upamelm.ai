FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
CMD ["npx", "playwright", "test"]

