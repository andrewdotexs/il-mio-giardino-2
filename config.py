"""
config.py - Configurazione centralizzata per Il Mio Giardino v2.0

Tutte le costanti che potresti voler modificare (porte, path, nomi di file)
sono raccolte qui in modo che non siano sparse nel codice. Se in futuro
dovessi cambiare la porta o spostare il database, modifichi solo questo file.
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Percorsi base
# ---------------------------------------------------------------------------
# BASE_DIR è la cartella in cui si trova questo file.
# Lo ricaviamo dinamicamente così il progetto funziona indipendentemente da
# dove lo esegui (Termux, Raspberry Pi, sviluppo in locale).
BASE_DIR = Path(__file__).resolve().parent

# Cartella dei file statici serviti dal server (HTML, CSS, JS, icone, manifest)
STATIC_DIR = BASE_DIR / "static"

# File del database SQLite. Viene creato automaticamente al primo avvio.
DB_PATH = BASE_DIR / "giardino.db"

# ---------------------------------------------------------------------------
# Server HTTP
# ---------------------------------------------------------------------------
HOST = "0.0.0.0"   # 0.0.0.0 = ascolta su tutte le interfacce (serve per Tailscale/LAN)
PORT = 8765        # Stessa porta della v1.0 per non cambiare abitudini

# ---------------------------------------------------------------------------
# Metadati applicazione
# ---------------------------------------------------------------------------
APP_NAME = "Il Mio Giardino"
APP_VERSION = "2.0.0"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
# Se True, il server stampa ogni richiesta ricevuta. Utile in sviluppo,
# rumoroso in produzione.
VERBOSE_LOGGING = True
