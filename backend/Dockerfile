# Бэкенд: API для фронтенда и сервиса chat, PostgreSQL, журнал, решения инспектора.
# Файлов и PDF здесь нет — их проверяет сервис checker (очередь Redis), модели — сервис chat.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Прод: gunicorn; состояние — в PostgreSQL и Redis, поэтому процессов может быть несколько.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "8", "--timeout", "300", "--access-logfile", "-"]
