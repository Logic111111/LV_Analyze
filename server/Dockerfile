# Built from the repository root (docker-compose: context ".", dockerfile server/Dockerfile) so the
# image contains the shared engine package next to the server, as in the repository (P7.1).
# Debian, not Alpine: the OpenDSS check's dss-python-backend ships only glibc (manylinux) wheels.
FROM node:22-bookworm-slim

# Python 3 with opendssdirect.py for the automatic OpenDSS cross-check (src/routes/opendss.js).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/opendss \
 && /opt/opendss/bin/pip install --no-cache-dir opendssdirect.py==0.9.4
ENV OPENDSS_PYTHON=/opt/opendss/bin/python

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src ./src
# Numbered migrations, applied at start-up (P7.2).
COPY server/sql ./sql
# The shared engine (pure ES modules), loaded with import() by src/engine.js.
COPY packages/engine /app/packages/engine
# The validator the OpenDSS check runs with --single (src/routes/opendss.js looks in /app/scripts).
COPY scripts/validate-opendss.py /app/scripts/validate-opendss.py

ENV NODE_ENV=production
EXPOSE 4000
USER node

CMD ["node", "src/index.js"]
