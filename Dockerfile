# Doc-Flow — Container-Image für Coolify.
#
# Mehrstufig, damit im laufenden Image weder Quellcode noch Build-Werkzeuge
# liegen. Läuft als non-root.
#
# Debian (bookworm-slim) statt Alpine: Argon2 und sharp kommen als
# vorkompilierte Bibliotheken für glibc. Unter Alpine (musl) bräuchte es
# jeweils eine andere Variante — ein vermeidbares Risiko bei der
# Passwortprüfung und der Bildaufbereitung.

# ============================================================
# 1. Abhängigkeiten
# ============================================================
FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# package.json enthält "postinstall": "prisma generate". Das Schema muss
# deshalb schon hier vorhanden sein, sonst bricht "npm ci" ab.
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# `npm ci` statt `npm install`: installiert exakt die Stände aus dem
# Lockfile. Ein Build darf nicht davon abhängen, wann er läuft.
RUN npm ci

# ============================================================
# 2. Build
# ============================================================
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate

# Für den Build wird keine echte Datenbank gebraucht; der Platzhalter
# verhindert nur, dass die Prüfung in src/server/db.ts beim Sammeln der
# Seitendaten anschlägt.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1

# APP_ORIGIN muss hier ankommen, nicht erst zur Laufzeit: next.config.ts liest
# process.env.APP_ORIGIN beim Laden der Konfiguration, und im Standalone-Modus
# geschieht das genau einmal während "next build". Der Wert landet fest in
# .next/required-server-files.json — ein erst beim Containerstart gesetzter
# Wert würde nie gelesen. In Coolify muss diese Variable deshalb als
# "Available during build" markiert sein, sonst scheitert in Produktion jede
# Server Action mit einem CSRF-Fehler.
ARG APP_ORIGIN
ENV APP_ORIGIN=$APP_ORIGIN

RUN npm run build

# ============================================================
# 3. Prisma-CLI für die Migrationen zur Laufzeit
# ============================================================
# Eigene, isolierte Installation statt einzelner node_modules-Unterordner: Das
# Paket "prisma" lädt an seinem CLI-Einstiegspunkt alle Unterbefehle und zieht
# dafür Abhängigkeiten nach, die nicht zu den von Next.js für den
# Standalone-Build getracten gehören. npm löst den vollständigen Baum hier
# selbst auf — das ist mehr Platz, aber zuverlässig statt fragil.
FROM node:24-bookworm-slim AS prisma-cli
WORKDIR /prisma-cli
RUN npm install --omit=dev --no-audit --no-fund \
      prisma@7.10.0 @prisma/adapter-pg@7.10.0 dotenv@17.4.2

# ============================================================
# 4. Laufzeit
# ============================================================
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# tesseract-ocr-deu: das deutsche Sprachmodell — ohne es liest die
#   Texterkennung Umlaute und deutsche Wörter deutlich schlechter.
# tesseract-ocr-osd: erkennt die Ausrichtung einer Seite, damit ein quer
#   eingescanntes Blatt vor der Erkennung gedreht wird.
# age: optionale Verschlüsselung der Backups.
# pg_dump in Version 17 — ein älteres pg_dump verweigert den Abzug einer
#   neueren Serverversion. Deshalb das offizielle PostgreSQL-Paketarchiv.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-client-17 \
      tesseract-ocr tesseract-ocr-deu tesseract-ocr-osd \
      age \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*

# Der Standalone-Build bringt den Server samt der tatsächlich benötigten
# Abhängigkeiten mit.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Für `prisma migrate deploy` beim Start.
COPY --from=prisma-cli --chown=node:node /prisma-cli/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts

COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
COPY --chown=node:node scripts ./scripts
RUN chmod +x ./docker-entrypoint.sh ./scripts/restore.sh

# Originaldokumente und Backups. /data MUSS in Coolify als Volume eingehängt
# sein — ohne das wären nach dem nächsten Deployment alle Dokumente weg.
RUN mkdir -p /data/files /data/backups && chown -R node:node /data
ENV FILES_DIR=/data/files
ENV BACKUP_DIR=/data/backups
ENV PG_DUMP_PATH=/usr/bin/pg_dump
ENV TESSERACT_PATH=/usr/bin/tesseract

# Tesseract würde sonst alle Kerne für eine einzelne Seite belegen und den
# Webserver ausbremsen.
ENV OMP_THREAD_LIMIT=1

# Im Container auf allen Schnittstellen lauschen; nach außen steht
# ausschließlich der Proxy von Coolify.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
