"""
server.py - API REST e server statico per Il Mio Giardino v2.0

Questo server fa due cose contemporaneamente:

1. Serve i file statici (HTML/CSS/JS/icone) dalla cartella `static/`.
2. Espone una API REST sotto il prefisso `/api/` che legge e scrive
   sul database SQLite definito in database.py.

Scelta progettuale: usiamo ESCLUSIVAMENTE la libreria standard di Python.
Questo rende il deploy banale su Termux/Android e Raspberry Pi: nessun
`pip install`, nessun virtual environment, nessun conflitto di versioni.

ARCHITETTURA DELL'API:

  Risorse anagrafiche (cataloghi):
    GET    /api/piante              -> lista
    POST   /api/piante              -> crea
    GET    /api/piante/<id>         -> dettaglio
    PUT    /api/piante/<id>         -> aggiorna
    DELETE /api/piante/<id>         -> rimuove

  Stesso pattern per: /api/fertilizzanti, /api/substrati, /api/fitopatie

  Risorsa transazionale (vasi):
    GET    /api/vasi                -> lista con JOIN su pianta e substrato
    POST   /api/vasi                -> crea, accetta array `fertilizzanti` e `fitopatie`
    GET    /api/vasi/<id>           -> dettaglio completo con relazioni
    PUT    /api/vasi/<id>           -> aggiorna, risincronizza relazioni
    DELETE /api/vasi/<id>           -> rimuove (CASCADE sulle giunzioni)

  Utilità:
    GET    /api/health              -> healthcheck, utile per debugging
"""

import json
import sqlite3
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from pathlib import Path

from config import HOST, PORT, STATIC_DIR, VERBOSE_LOGGING, APP_NAME, APP_VERSION
from database import init_db, seed_if_empty, get_connection


# ===========================================================================
# UTILITÀ
# ===========================================================================

def row_to_dict(row):
    """Converte un sqlite3.Row in un dict JSON-serializzabile."""
    return {k: row[k] for k in row.keys()} if row else None


def rows_to_list(rows):
    """Converte una lista di sqlite3.Row in una lista di dict."""
    return [row_to_dict(r) for r in rows]


# MIME types per i file statici. Volutamente ridotto: servire solo ciò
# che ci serve davvero per una PWA semplice.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico":  "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".txt":  "text/plain; charset=utf-8",
}


# ===========================================================================
# BUSINESS LOGIC: operazioni CRUD per ciascuna risorsa
# ===========================================================================
# Tengo la logica separata dal routing HTTP. Le funzioni qui sotto lavorano
# su dict Python e restituiscono dict Python: il routing si preoccupa solo
# di parsing JSON, codici di stato e conversione.
# ===========================================================================

# ----- Piante --------------------------------------------------------------
def piante_list():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM piante ORDER BY nome_comune COLLATE NOCASE"
        ).fetchall()
        return rows_to_list(rows)
    finally:
        conn.close()


def piante_get(pid):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM piante WHERE id = ?", (pid,)).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


# Campi della tabella `piante` scrivibili dall'API. Ogni campo è una
# colonna fisica del DB; le query di INSERT e UPDATE vengono costruite
# dinamicamente da questa lista. Quando in futuro si aggiungerà un nuovo
# campo alla scheda agronomica basterà aggiungerlo qui e aggiornare il
# form frontend — server.py non richiede altre modifiche.
#
# L'ordine è pensato per raggruppare logicamente i campi come appaiono
# nel form (identificazione → chip header → concimazione → substrato →
# esposizione → cure → note generali).
CAMPI_PIANTA_SCRIVIBILI = [
    # Identificazione
    "nome_comune", "nome_scientifico", "famiglia", "tipo_ambiente",
    # Classificazione rapida
    "difficolta", "stagionalita", "linea_fertilizzanti",
    # Concimazione
    "conc_periodo", "conc_frequenza", "conc_tipo", "conc_stop", "conc_note",
    # Substrato
    "sub_descrizione", "ph_ideale_min", "ph_ideale_max",
    "vaso_consigliato", "rinvaso_frequenza", "terreno_vivo",
    # Esposizione (campo strutturato + descrittivi)
    "luce", "luce_descrizione", "sole_diretto",
    "temp_min_c", "temp_max_c",
    "umidita_ottimale", "umidita_descrizione",
    # Cure
    "annaffiatura", "potatura", "parassiti", "da_sapere",
    # Note generali
    "note",
]


def _valori_pianta(data):
    """
    Estrae i valori scrivibili da `data` nell'ordine di CAMPI_PIANTA_SCRIVIBILI.
    I campi mancanti diventano None (= NULL in SQLite). `tipo_ambiente` ha
    un fallback a 'esterno' per rispettare il DEFAULT dello schema.
    """
    out = []
    for nome in CAMPI_PIANTA_SCRIVIBILI:
        if nome == "tipo_ambiente":
            out.append(data.get(nome) or "esterno")
        else:
            out.append(data.get(nome))
    return out


def piante_create(data):
    """
    Crea una pianta. `data` deve contenere almeno `nome_comune`.
    Restituisce la riga appena creata.
    """
    colonne = ", ".join(CAMPI_PIANTA_SCRIVIBILI)
    placeholder = ", ".join(["?"] * len(CAMPI_PIANTA_SCRIVIBILI))
    conn = get_connection()
    try:
        cur = conn.execute(
            f"INSERT INTO piante ({colonne}) VALUES ({placeholder})",
            _valori_pianta(data),
        )
        conn.commit()
        return piante_get(cur.lastrowid)
    finally:
        conn.close()


def piante_update(pid, data):
    """
    Aggiorna tutti i campi scrivibili di una pianta. I campi non presenti
    in `data` vengono impostati a NULL — il form lato client invia sempre
    tutti i campi del form, quindi questo pattern è coerente con la UI.
    """
    set_clause = ", ".join(f"{c} = ?" for c in CAMPI_PIANTA_SCRIVIBILI)
    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE piante SET {set_clause}, updated_at = datetime('now') "
            f"WHERE id = ?",
            _valori_pianta(data) + [pid],
        )
        conn.commit()
        return piante_get(pid)
    finally:
        conn.close()


def piante_delete(pid):
    """
    Cancella una pianta. Se ha vasi associati, la FOREIGN KEY RESTRICT
    farà fallire la query con IntegrityError, che il routing tradurrà
    in 409 Conflict.
    """
    conn = get_connection()
    try:
        conn.execute("DELETE FROM piante WHERE id = ?", (pid,))
        conn.commit()
    finally:
        conn.close()


# ----- Fertilizzanti -------------------------------------------------------
def fertilizzanti_list():
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM fertilizzanti
               ORDER BY marca COLLATE NOCASE, nome COLLATE NOCASE"""
        ).fetchall()
        return rows_to_list(rows)
    finally:
        conn.close()


def fertilizzanti_get(fid):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM fertilizzanti WHERE id = ?", (fid,)).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


def fertilizzanti_create(data):
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO fertilizzanti
               (nome, marca, npk_n, npk_p, npk_k, tipo, forma, dosaggio_ml_per_l, note, preimpostato)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (
                data.get("nome"), data.get("marca"),
                data.get("npk_n"), data.get("npk_p"), data.get("npk_k"),
                data.get("tipo"), data.get("forma"),
                data.get("dosaggio_ml_per_l"), data.get("note"),
            ),
        )
        conn.commit()
        return fertilizzanti_get(cur.lastrowid)
    finally:
        conn.close()


def fertilizzanti_update(fid, data):
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE fertilizzanti SET
                 nome = ?, marca = ?, npk_n = ?, npk_p = ?, npk_k = ?,
                 tipo = ?, forma = ?, dosaggio_ml_per_l = ?, note = ?
               WHERE id = ?""",
            (
                data.get("nome"), data.get("marca"),
                data.get("npk_n"), data.get("npk_p"), data.get("npk_k"),
                data.get("tipo"), data.get("forma"),
                data.get("dosaggio_ml_per_l"), data.get("note"),
                fid,
            ),
        )
        conn.commit()
        return fertilizzanti_get(fid)
    finally:
        conn.close()


def fertilizzanti_delete(fid):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM fertilizzanti WHERE id = ?", (fid,))
        conn.commit()
    finally:
        conn.close()


# ----- Substrati -----------------------------------------------------------
# I substrati hanno `composizione` come JSON: serializziamo/deserializziamo
# al confine con il database. Dal punto di vista dell'API esterna è sempre
# un array di oggetti, mai una stringa.

def _substrato_decode(row):
    """Converte una riga di substrati deserializzando il JSON composizione."""
    if not row:
        return None
    d = row_to_dict(row)
    try:
        d["composizione"] = json.loads(d["composizione"]) if d.get("composizione") else []
    except (json.JSONDecodeError, TypeError):
        d["composizione"] = []
    return d


def substrati_list():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM substrati ORDER BY preimpostato DESC, nome COLLATE NOCASE"
        ).fetchall()
        return [_substrato_decode(r) for r in rows]
    finally:
        conn.close()


def substrati_get(sid):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM substrati WHERE id = ?", (sid,)).fetchone()
        return _substrato_decode(row)
    finally:
        conn.close()


def substrati_create(data):
    conn = get_connection()
    try:
        composizione = data.get("composizione", [])
        if not isinstance(composizione, list):
            composizione = []
        cur = conn.execute(
            """INSERT INTO substrati
               (nome, descrizione, composizione, whc, ph_min, ph_max, drenaggio, note, preimpostato)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (
                data.get("nome"), data.get("descrizione"),
                json.dumps(composizione, ensure_ascii=False),
                data.get("whc"), data.get("ph_min"), data.get("ph_max"),
                data.get("drenaggio"), data.get("note"),
            ),
        )
        conn.commit()
        return substrati_get(cur.lastrowid)
    finally:
        conn.close()


def substrati_update(sid, data):
    conn = get_connection()
    try:
        composizione = data.get("composizione", [])
        if not isinstance(composizione, list):
            composizione = []
        conn.execute(
            """UPDATE substrati SET
                 nome = ?, descrizione = ?, composizione = ?, whc = ?,
                 ph_min = ?, ph_max = ?, drenaggio = ?, note = ?
               WHERE id = ?""",
            (
                data.get("nome"), data.get("descrizione"),
                json.dumps(composizione, ensure_ascii=False),
                data.get("whc"), data.get("ph_min"), data.get("ph_max"),
                data.get("drenaggio"), data.get("note"),
                sid,
            ),
        )
        conn.commit()
        return substrati_get(sid)
    finally:
        conn.close()


def substrati_delete(sid):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM substrati WHERE id = ?", (sid,))
        conn.commit()
    finally:
        conn.close()


# ----- Fitopatie -----------------------------------------------------------
def fitopatie_list():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM fitopatie ORDER BY nome COLLATE NOCASE"
        ).fetchall()
        return rows_to_list(rows)
    finally:
        conn.close()


def fitopatie_get(fid):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM fitopatie WHERE id = ?", (fid,)).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


def fitopatie_create(data):
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO fitopatie
               (nome, tipo, sintomi, prevenzione, trattamento, note, preimpostato)
               VALUES (?, ?, ?, ?, ?, ?, 0)""",
            (
                data.get("nome"), data.get("tipo"),
                data.get("sintomi"), data.get("prevenzione"),
                data.get("trattamento"), data.get("note"),
            ),
        )
        conn.commit()
        return fitopatie_get(cur.lastrowid)
    finally:
        conn.close()


def fitopatie_update(fid, data):
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE fitopatie SET
                 nome = ?, tipo = ?, sintomi = ?, prevenzione = ?,
                 trattamento = ?, note = ?
               WHERE id = ?""",
            (
                data.get("nome"), data.get("tipo"),
                data.get("sintomi"), data.get("prevenzione"),
                data.get("trattamento"), data.get("note"),
                fid,
            ),
        )
        conn.commit()
        return fitopatie_get(fid)
    finally:
        conn.close()


def fitopatie_delete(fid):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM fitopatie WHERE id = ?", (fid,))
        conn.commit()
    finally:
        conn.close()


# ----- Componenti del substrato -------------------------------------------
# Anagrafica degli ingredienti che compongono i substrati. Esposta come
# risorsa propria /api/componenti così la UI può popolare la dropdown
# nell'editor di composizione e mostrare il pallino colorato per ogni
# componente (il campo `colore` è un codice hex tipo "#c96a2b").
#
# NB: NON c'è foreign key da substrati.composizione verso componenti.id
# perché composizione resta un JSON libero. Il legame è soft: il JSON
# conterrà `{componente_id: X, nome: "...", percentuale: Y}` e se un
# componente viene cancellato i substrati che lo usavano conservano il
# nome denormalizzato senza perdere dati.

def componenti_list():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM componenti_substrato "
            "ORDER BY preimpostato DESC, nome COLLATE NOCASE"
        ).fetchall()
        return rows_to_list(rows)
    finally:
        conn.close()


def componenti_get(cid):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM componenti_substrato WHERE id = ?", (cid,)
        ).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


def componenti_create(data):
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO componenti_substrato
               (nome, categoria, colore, descrizione, preimpostato)
               VALUES (?, ?, ?, ?, 0)""",
            (
                data.get("nome"),
                data.get("categoria"),
                data.get("colore"),
                data.get("descrizione"),
            ),
        )
        conn.commit()
        return componenti_get(cur.lastrowid)
    finally:
        conn.close()


def componenti_update(cid, data):
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE componenti_substrato SET
                 nome = ?, categoria = ?, colore = ?, descrizione = ?
               WHERE id = ?""",
            (
                data.get("nome"),
                data.get("categoria"),
                data.get("colore"),
                data.get("descrizione"),
                cid,
            ),
        )
        conn.commit()
        return componenti_get(cid)
    finally:
        conn.close()


def componenti_delete(cid):
    """
    Eliminazione "soft-safe": il componente non ha FK che lo ancorano,
    ma potrebbe essere referenziato nel JSON di composizione di uno o
    più substrati. Non impediamo la cancellazione — i substrati che
    contenevano un riferimento a questo id manterranno il nome
    denormalizzato e mostreranno il pallino grigio di default.
    Se in futuro servisse un check "usato in N substrati", è sufficiente
    scorrere `substrati.composizione` e contare i componente_id == cid.
    """
    conn = get_connection()
    try:
        conn.execute("DELETE FROM componenti_substrato WHERE id = ?", (cid,))
        conn.commit()
    finally:
        conn.close()


# ----- Vasi ----------------------------------------------------------------
# I vasi sono la risorsa più ricca: hanno foreign key verso piante e
# substrati, più due relazioni molti-a-molti (fertilizzanti, fitopatie).
# Il client ragiona sul vaso come un oggetto unico; il server si occupa
# di scomporlo nelle tabelle sottostanti.

def _vaso_decode(row):
    """Converte una riga di vasi (già JOIN-ata) in dict leggibile."""
    if not row:
        return None
    return row_to_dict(row)


def _vaso_load_relazioni(conn, vaso_id):
    """
    Dato un vaso, ritorna due liste:
    - fertilizzanti: [ids] dei fertilizzanti usati (ordinati per marca/nome)
    - fitopatie:     lista di oggetti episodio {id, fitopatia_id, nome, data_inizio, ...}
    """
    fert_rows = conn.execute(
        """SELECT f.id, f.nome, f.marca, f.npk_n, f.npk_p, f.npk_k
           FROM vasi_fertilizzanti vf
           JOIN fertilizzanti f ON f.id = vf.fertilizzante_id
           WHERE vf.vaso_id = ?
           ORDER BY f.marca COLLATE NOCASE, f.nome COLLATE NOCASE""",
        (vaso_id,),
    ).fetchall()

    fito_rows = conn.execute(
        """SELECT vf.id, vf.fitopatia_id, vf.data_inizio, vf.data_fine,
                  vf.gravita, vf.trattamento_in_corso, vf.note,
                  fp.nome AS fitopatia_nome, fp.tipo AS fitopatia_tipo
           FROM vasi_fitopatie vf
           JOIN fitopatie fp ON fp.id = vf.fitopatia_id
           WHERE vf.vaso_id = ?
           ORDER BY vf.data_inizio DESC""",
        (vaso_id,),
    ).fetchall()

    return rows_to_list(fert_rows), rows_to_list(fito_rows)


def vasi_list():
    """
    Lista dei vasi con i dati essenziali della pianta e del substrato
    già risolti via JOIN. Non carichiamo fertilizzanti/fitopatie qui per
    non appesantire: il dettaglio li include.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT v.*,
                      p.nome_comune      AS pianta_nome,
                      p.nome_scientifico AS pianta_nome_scientifico,
                      s.nome             AS substrato_nome
               FROM vasi v
               JOIN piante p    ON p.id = v.pianta_id
               LEFT JOIN substrati s ON s.id = v.substrato_id
               ORDER BY p.nome_comune COLLATE NOCASE, v.id"""
        ).fetchall()
        return rows_to_list(rows)
    finally:
        conn.close()


def vasi_get(vid):
    """Dettaglio completo di un vaso, incluse le relazioni."""
    conn = get_connection()
    try:
        row = conn.execute(
            """SELECT v.*,
                      p.nome_comune      AS pianta_nome,
                      p.nome_scientifico AS pianta_nome_scientifico,
                      s.nome             AS substrato_nome
               FROM vasi v
               JOIN piante p    ON p.id = v.pianta_id
               LEFT JOIN substrati s ON s.id = v.substrato_id
               WHERE v.id = ?""",
            (vid,),
        ).fetchone()
        if not row:
            return None
        vaso = row_to_dict(row)
        fert, fito = _vaso_load_relazioni(conn, vid)
        vaso["fertilizzanti"] = fert
        vaso["fitopatie"] = fito
        return vaso
    finally:
        conn.close()


def _vaso_sync_relazioni(conn, vaso_id, data):
    """
    Sincronizza le tabelle di giunzione dopo una create/update.

    Per i fertilizzanti: cancelliamo tutte le relazioni esistenti e
    reinseriamo quelle nuove. È più semplice che fare diff, e per le
    dimensioni in gioco (decine di voci al massimo) è più che adeguato.

    Per le fitopatie ragioniamo diversamente: ogni episodio ha ID proprio
    e metadati, quindi sovrascriverli brutalmente perderebbe la storia.
    Accettiamo solo array di *nuovi* episodi da aggiungere, che arriva
    dal form come `fitopatie_nuove`. Le modifiche/chiusure di episodi
    esistenti le faremo con endpoint dedicati in futuro.
    """
    # Fertilizzanti: wipe & rewrite
    if "fertilizzanti" in data:
        conn.execute("DELETE FROM vasi_fertilizzanti WHERE vaso_id = ?", (vaso_id,))
        ids = data.get("fertilizzanti") or []
        if ids:
            conn.executemany(
                "INSERT INTO vasi_fertilizzanti (vaso_id, fertilizzante_id) VALUES (?, ?)",
                [(vaso_id, fid) for fid in ids if fid is not None],
            )

    # Fitopatie nuove (aggiunte, non sostituzioni)
    nuove = data.get("fitopatie_nuove") or []
    for ep in nuove:
        conn.execute(
            """INSERT INTO vasi_fitopatie
               (vaso_id, fitopatia_id, data_inizio, gravita, trattamento_in_corso, note)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (
                vaso_id,
                ep.get("fitopatia_id"),
                ep.get("data_inizio"),
                ep.get("gravita"),
                ep.get("note"),
            ),
        )


def vasi_create(data):
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO vasi
               (pianta_id, soprannome, posizione, esemplari,
                forma, materiale, diametro_sup_cm, diametro_inf_cm,
                lunghezza_cm, larghezza_cm, altezza_cm, volume_l,
                substrato_id, data_invaso, data_ultimo_rinvaso,
                data_ultima_annaffiatura, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data.get("pianta_id"), data.get("soprannome"),
                data.get("posizione", "esterno"), data.get("esemplari", 1),
                data.get("forma", "cilindrico"), data.get("materiale", "plastica"),
                data.get("diametro_sup_cm"), data.get("diametro_inf_cm"),
                data.get("lunghezza_cm"), data.get("larghezza_cm"),
                data.get("altezza_cm"), data.get("volume_l"),
                data.get("substrato_id"),
                data.get("data_invaso"), data.get("data_ultimo_rinvaso"),
                data.get("data_ultima_annaffiatura"), data.get("note"),
            ),
        )
        new_id = cur.lastrowid
        _vaso_sync_relazioni(conn, new_id, data)
        conn.commit()
        return vasi_get(new_id)
    finally:
        conn.close()


def vasi_update(vid, data):
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE vasi SET
                 pianta_id = ?, soprannome = ?, posizione = ?, esemplari = ?,
                 forma = ?, materiale = ?, diametro_sup_cm = ?, diametro_inf_cm = ?,
                 lunghezza_cm = ?, larghezza_cm = ?, altezza_cm = ?, volume_l = ?,
                 substrato_id = ?, data_invaso = ?, data_ultimo_rinvaso = ?,
                 data_ultima_annaffiatura = ?, note = ?, updated_at = datetime('now')
               WHERE id = ?""",
            (
                data.get("pianta_id"), data.get("soprannome"),
                data.get("posizione", "esterno"), data.get("esemplari", 1),
                data.get("forma", "cilindrico"), data.get("materiale", "plastica"),
                data.get("diametro_sup_cm"), data.get("diametro_inf_cm"),
                data.get("lunghezza_cm"), data.get("larghezza_cm"),
                data.get("altezza_cm"), data.get("volume_l"),
                data.get("substrato_id"),
                data.get("data_invaso"), data.get("data_ultimo_rinvaso"),
                data.get("data_ultima_annaffiatura"), data.get("note"),
                vid,
            ),
        )
        _vaso_sync_relazioni(conn, vid, data)
        conn.commit()
        return vasi_get(vid)
    finally:
        conn.close()


def vasi_delete(vid):
    conn = get_connection()
    try:
        # Le giunzioni si cancellano automaticamente (ON DELETE CASCADE).
        conn.execute("DELETE FROM vasi WHERE id = ?", (vid,))
        conn.commit()
    finally:
        conn.close()


# ===========================================================================
# ROUTING HTTP
# ===========================================================================
# Mappa (METODO, PATTERN regex) -> funzione handler. Le funzioni ricevono
# l'handler HTTP e i gruppi catturati dalla regex; ritornano (status, body).
# ===========================================================================

# Dispatch per risorsa. Ogni entry mappa il nome di risorsa nell'URL a
# una tupla di funzioni CRUD (list, get, create, update, delete).
RESOURCES = {
    "piante":         (piante_list,         piante_get,         piante_create,         piante_update,         piante_delete),
    "fertilizzanti":  (fertilizzanti_list,  fertilizzanti_get,  fertilizzanti_create,  fertilizzanti_update,  fertilizzanti_delete),
    "substrati":      (substrati_list,      substrati_get,      substrati_create,      substrati_update,      substrati_delete),
    "fitopatie":      (fitopatie_list,      fitopatie_get,      fitopatie_create,      fitopatie_update,      fitopatie_delete),
    "componenti":     (componenti_list,     componenti_get,     componenti_create,     componenti_update,     componenti_delete),
    "vasi":           (vasi_list,           vasi_get,           vasi_create,           vasi_update,           vasi_delete),
}


class GardenHandler(BaseHTTPRequestHandler):
    """
    Request handler. Estende BaseHTTPRequestHandler implementando i verbi
    HTTP che ci servono. La struttura è sempre la stessa:
    1) Parsiamo il path.
    2) Se inizia con /api, dispatch all'handler API.
    3) Altrimenti serviamo un file statico (con fallback a index.html per SPA).
    """

    # -------------------- risposta --------------------
    def _send_json(self, status, data):
        """Helper: manda una risposta JSON con lo status dato."""
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_json(status, {"error": message})

    def _read_json(self):
        """Legge il body della richiesta e lo interpreta come JSON."""
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"JSON non valido: {e}")

    # -------------------- static files --------------------
    def _serve_static(self, path):
        """
        Serve file dalla cartella static/. Path traversal (../) bloccato
        confrontando il path risolto con STATIC_DIR.
        """
        # Rimuovi slash iniziale e default a index.html
        rel = path.lstrip("/") or "index.html"
        target = (STATIC_DIR / rel).resolve()

        # Security: target deve essere dentro STATIC_DIR
        if STATIC_DIR not in target.parents and target != STATIC_DIR:
            self._send_error(403, "Accesso negato")
            return

        if not target.is_file():
            # Fallback a index.html per una futura SPA con routing client-side.
            # Per ora le sezioni sono gestite a tab nello stesso index, ma il
            # fallback è comunque utile (es. utente che ricarica su /piante).
            target = STATIC_DIR / "index.html"
            if not target.is_file():
                self._send_error(404, "Not found")
                return

        ext = target.suffix.lower()
        mime = MIME_TYPES.get(ext, "application/octet-stream")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        # Niente cache aggressivo in sviluppo: il service worker gestisce
        # la cache lato client.
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # -------------------- API dispatch --------------------
    def _handle_api(self, method, path):
        """
        Dispatch delle richieste API. Riconosciamo:
          /api/health
          /api/<risorsa>
          /api/<risorsa>/<id>
        """
        # Health check
        if path == "/api/health":
            self._send_json(200, {"status": "ok", "app": APP_NAME, "version": APP_VERSION})
            return

        # Match /api/<risorsa>[/<id>]
        m = re.match(r"^/api/([a-z]+)(?:/(\d+))?/?$", path)
        if not m:
            self._send_error(404, f"Endpoint sconosciuto: {path}")
            return

        resource = m.group(1)
        res_id = int(m.group(2)) if m.group(2) else None

        if resource not in RESOURCES:
            self._send_error(404, f"Risorsa sconosciuta: {resource}")
            return

        list_fn, get_fn, create_fn, update_fn, delete_fn = RESOURCES[resource]

        try:
            if method == "GET" and res_id is None:
                self._send_json(200, list_fn())
            elif method == "GET":
                item = get_fn(res_id)
                if item is None:
                    self._send_error(404, "Non trovato")
                else:
                    self._send_json(200, item)
            elif method == "POST" and res_id is None:
                data = self._read_json()
                created = create_fn(data)
                self._send_json(201, created)
            elif method == "PUT" and res_id is not None:
                if get_fn(res_id) is None:
                    self._send_error(404, "Non trovato")
                    return
                data = self._read_json()
                updated = update_fn(res_id, data)
                self._send_json(200, updated)
            elif method == "DELETE" and res_id is not None:
                if get_fn(res_id) is None:
                    self._send_error(404, "Non trovato")
                    return
                delete_fn(res_id)
                self._send_json(200, {"deleted": res_id})
            else:
                self._send_error(405, f"Metodo {method} non consentito")
        except ValueError as e:
            # JSON malformato o tipi sbagliati
            self._send_error(400, str(e))
        except sqlite3.IntegrityError as e:
            # FK RESTRICT, UNIQUE violati, CHECK falliti
            self._send_error(409, f"Conflitto di integrità: {e}")
        except Exception as e:
            # Catch-all: logghiamo ma non esponiamo dettagli interni
            if VERBOSE_LOGGING:
                import traceback; traceback.print_exc()
            self._send_error(500, f"Errore interno: {e}")

    # -------------------- verbi HTTP --------------------
    def _route(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api"):
            self._handle_api(method, path)
        elif method == "GET":
            self._serve_static(path)
        else:
            self._send_error(405, f"Metodo {method} non consentito su {path}")

    def do_GET(self):    self._route("GET")
    def do_POST(self):   self._route("POST")
    def do_PUT(self):    self._route("PUT")
    def do_DELETE(self): self._route("DELETE")

    # Silenzia il log di default (che stampa su stderr) e usiamo il nostro.
    def log_message(self, format, *args):
        if VERBOSE_LOGGING:
            print(f"[{self.log_date_time_string()}] {self.address_string()} - {format % args}")


# ===========================================================================
# MAIN
# ===========================================================================
def main():
    print(f"=== {APP_NAME} v{APP_VERSION} ===")
    print("Inizializzazione database...")
    init_db()
    seed_if_empty()

    server = ThreadingHTTPServer((HOST, PORT), GardenHandler)
    print(f"Server pronto su http://{HOST}:{PORT}/")
    print("Premi Ctrl+C per fermare.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto del server.")
        server.server_close()


if __name__ == "__main__":
    main()
