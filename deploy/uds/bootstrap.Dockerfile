FROM cgr.dev/chainguard/python:latest@sha256:f73b534b99afc3a17c9d7a863a688d9c2577de23e12af21d55ad7b3fdbaf83f0
# Python 3.15.2, with the standard library and runtime libraries only.
# Preserve the supplier's package metadata so scans cover the complete runtime.
WORKDIR /opt/parse-command/backend/search
COPY backend/search/deploy.py backend/search/search_config.py backend/search/model.json ./
COPY backend/search/assets/model.zip ./assets/model.zip
COPY docs/opensearch /opt/parse-command/docs/opensearch
USER 65532:65532
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PARSE_COMMAND_SEARCH_STATE=/tmp/bootstrap
ENTRYPOINT ["/usr/bin/python", "deploy.py"]
