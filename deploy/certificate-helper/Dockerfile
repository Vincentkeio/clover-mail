FROM python:3.12-slim
RUN apt-get update \
 && if apt-cache show docker-cli >/dev/null 2>&1; then DOCKER_CLI_PACKAGE=docker-cli; else DOCKER_CLI_PACKAGE=docker.io; fi \
 && if apt-cache show docker-compose-plugin >/dev/null 2>&1; then COMPOSE_PACKAGE=docker-compose-plugin; else COMPOSE_PACKAGE=docker-compose; fi \
 && apt-get install -y --no-install-recommends util-linux tar "$DOCKER_CLI_PACKAGE" "$COMPOSE_PACKAGE" ca-certificates openssl iproute2 \
 && command -v docker \
 && docker --version \
 && (docker compose version || docker-compose --version) \
 && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
WORKDIR /app
COPY scripts/certificates.py /app/certificates.py
COPY scripts/host-caddy.py /app/host-caddy.py
CMD ["sleep", "infinity"]
