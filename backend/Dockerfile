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
       ca-certificates \
    && rm -rf /var/lib/apt/lists/* || true
# Языковых моделей здесь нет: заключение моделью, описание фото и чат — сервис chat.
# Раскладка как в репозитории: /app/backend, /app/dataset и /app/runs монтируются из compose.yml
WORKDIR /app/backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Прод: gunicorn, один процесс с потоками — фоновые проверки и их статус живут в одном процессе.
# Для разработки compose.yml запускает runserver с автоперезагрузкой.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "8", "--timeout", "600", "--access-logfile", "-"]