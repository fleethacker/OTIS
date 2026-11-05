FROM python:3.13.9-slim-bookworm@sha256:b685a4fa58bb19d1814d78a1ec0f0208f351452724f78b20212c984d6e124a34
WORKDIR /opt/parse-command/backend/search
COPY backend/search/deploy.py backend/search/search_config.py backend/search/model.json ./
COPY backend/search/assets/model.zip ./assets/model.zip
COPY docs/opensearch /opt/parse-command/docs/opensearch
USER 65532:65532
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PARSE_COMMAND_SEARCH_STATE=/tmp/bootstrap
ENTRYPOINT ["python3", "deploy.py"]
