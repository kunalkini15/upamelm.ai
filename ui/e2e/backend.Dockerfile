FROM python:3.12-slim
WORKDIR /app
COPY backend/ ./
RUN python -m pip install --no-cache-dir -e .
EXPOSE 8010
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8010", "--app-dir", "src"]

