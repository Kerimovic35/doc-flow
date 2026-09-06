#!/bin/sh
#
# Wiederherstellung aus einem Backup.
#
# Bewusst ein Skript und keine Schaltflaeche in der Anwendung: Der Vorgang
# ueberschreibt die laufende Datenbank, und ein Fehlklick waere nicht
# rueckgaengig zu machen.
#
# Aufruf im Container (Coolify: Terminal der Anwendung):
#   ./scripts/restore.sh /data/backups/docflow-db-2026-09-06T03-30-00.dump
#
# Danach die Dateiarchive auspacken, aeltestes zuerst:
#   for f in /data/backups/docflow-files-full-*.tar.gz /data/backups/docflow-files-inc-*.tar.gz; do
#     tar -xzf "$f" -C /data/files
#   done
#
# Verschluesselte Abzuege (.age) vorher entschluesseln:
#   age -d -i /pfad/zum/schluessel.txt datei.dump.age > datei.dump

set -e

DUMP="$1"

if [ -z "$DUMP" ]; then
	echo "Aufruf: $0 <pfad/zum/backup.dump>" >&2
	exit 1
fi

if [ ! -f "$DUMP" ]; then
	echo "FEHLER: $DUMP existiert nicht." >&2
	exit 1
fi

if [ -z "$DATABASE_URL" ]; then
	echo "FEHLER: DATABASE_URL ist nicht gesetzt." >&2
	exit 1
fi

echo "Dies überschreibt die Datenbank hinter DATABASE_URL vollständig."
echo "Zum Fortfahren  ja  eingeben:"
read -r ANTWORT

if [ "$ANTWORT" != "ja" ]; then
	echo "Abgebrochen."
	exit 1
fi

# --clean --if-exists: bestehende Objekte werden vorher entfernt, ohne dass
# ein fehlendes Objekt den Lauf abbricht.
# --no-owner: der Eigentuemer in der Zieldatenbank kann ein anderer sein als
# im Ursprung.
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP"

echo "Datenbank wiederhergestellt."
echo "Nicht vergessen: Dateiarchive auspacken (siehe Kopf dieses Skripts)."
