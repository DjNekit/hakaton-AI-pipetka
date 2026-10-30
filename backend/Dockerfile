FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# tesseract с русским языком — в образе, на хост ничего ставить не нужно; libglib — для OpenCV
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-rus libglib2.0-0 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Сертификаты НУЦ Минцифры — без них не проверить TLS-сертификат GigaChat API. Если gu-st.ru недоступен при сборке,
# образ всё равно собирается; тогда задайте GIGACHAT_VERIFY_SSL=0 (только для отладки) или GIGACHAT_CA_BUNDLE.
RUN python -c "import urllib.request as u; [open(f'/usr/local/share/ca-certificates/{n}.crt', 'wb').write(u.urlopen(f'https://gu-st.ru/content/lending/{n}.crt', timeout=30).read()) for n in ('russian_trusted_root_ca_pem', 'russian_trusted_sub_ca_pem')]" \
 && update-ca-certificates || echo "Сертификаты НУЦ Минцифры не установлены"
# Раскладка как в репозитории: /app/backend, /app/dataset и /app/runs монтируются из compose.yml
WORKDIR /app/backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Прод: gunicorn, один процесс с потоками — фоновые проверки и их статус живут в одном процессе.
# Для разработки compose.yml запускает runserver с автоперезагрузкой.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "8", "--timeout", "600", "--access-logfile", "-"]
