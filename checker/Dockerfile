# Сервис checker: проверка PDF, OCR, листы, сравнение фото, Excel и хранение файлов (runs/).
# Задачи берёт из очереди Redis, файлы отдаёт по HTTP (/files/…).
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# tesseract с русским языком — в образе, на хост ничего ставить не нужно; libglib — для OpenCV
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update || true \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       tesseract-ocr-rus \
       libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/* || true
# Раскладка как в репозитории: /app/checker, /app/dataset и /app/runs монтируются из compose
WORKDIR /app/checker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/files/health', timeout=4)"
CMD ["python", "-m", "worker"]
