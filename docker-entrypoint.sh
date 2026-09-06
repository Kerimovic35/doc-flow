#!/bin/sh
#
# Start im Container.
#
# Reihenfolge ist Absicht: erst prüfen, dann migrieren, dann starten. Startete
# der Server zuerst, könnte er kurzzeitig gegen ein veraltetes Schema arbeiten
# und dabei Fehler produzieren, die schwer zuzuordnen wären.

set -e

if [ -z "$DATABASE_URL" ]; then
	echo "FEHLER: DATABASE_URL ist nicht gesetzt. In Coolify unter Environment Variables eintragen." >&2
	exit 1
fi

if [ -z "$SESSION_SECRET" ]; then
	echo "FEHLER: SESSION_SECRET ist nicht gesetzt. Erzeugen mit: openssl rand -hex 32" >&2
	exit 1
fi

# Hier wird bewusst abgebrochen und nicht nur gewarnt: Ohne beschreibbares
# Dateiverzeichnis nimmt die Anwendung Dokumente entgegen, die beim nächsten
# Deployment verschwinden. Ein Start, der Daten verliert, ist schlimmer als
# gar kein Start.
FILES_DIR="${FILES_DIR:-/data/files}"
mkdir -p "$FILES_DIR" 2>/dev/null || true

if [ ! -w "$FILES_DIR" ]; then
	echo "FEHLER: $FILES_DIR ist nicht beschreibbar." >&2
	echo "        In Coolify ein Volume (keinen Host-Pfad) auf /data einhängen." >&2
	exit 1
fi

# Backups sind wichtig, aber die Anwendung ist auch ohne sie benutzbar -
# deshalb hier nur ein Hinweis.
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
mkdir -p "$BACKUP_DIR" 2>/dev/null || true

if [ ! -w "$BACKUP_DIR" ]; then
	echo "WARNUNG: $BACKUP_DIR ist nicht beschreibbar - es werden KEINE Backups erstellt." >&2
fi

echo "==> Datenbankmigrationen einspielen"
# migrate deploy spielt ausschließlich vorhandene Migrationen ein und erzeugt
# niemals neue - anders als migrate dev.
node node_modules/prisma/build/index.js migrate deploy

echo "==> Anwendung starten"
exec node server.js
