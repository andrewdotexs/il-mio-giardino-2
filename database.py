"""
database.py - Schema del database e seed dei dati preimpostati

Questo modulo ha due responsabilità:

1. DEFINIRE LO SCHEMA: creare le tabelle SQLite se non esistono. Lo facciamo
   con CREATE TABLE IF NOT EXISTS in modo che sia sicuro richiamare init_db()
   ad ogni avvio senza distruggere i dati esistenti.

2. POPOLARE I DATI PREIMPOSTATI: al primo avvio inseriamo i fertilizzanti,
   i substrati e le fitopatie più comuni così l'utente non parte da zero.
   Usiamo il flag 'preimpostato' per distinguerli da quelli aggiunti
   dall'utente: questo permette (in futuro) di offrire un pulsante
   "ripristina preimpostati" senza toccare le anagrafiche personalizzate.

SCELTE ARCHITETTURALI IMPORTANTI:

- Foreign key ABILITATE (PRAGMA foreign_keys = ON) perché di default SQLite
  non le applica. Senza questo, potresti cancellare una pianta e lasciare
  vasi "orfani" che puntano a un ID inesistente.

- ON DELETE RESTRICT sulle FK dei vasi: non puoi cancellare una pianta se
  ha vasi associati. Meglio un errore esplicito che una cascata accidentale.

- ON DELETE CASCADE sulle tabelle di giunzione (vasi_fertilizzanti,
  vasi_fitopatie): se cancelli il vaso, spariscono anche le sue relazioni.

- Timestamp created_at/updated_at in formato ISO 8601 come stringa. SQLite
  non ha un tipo "datetime" nativo; le stringhe ISO si ordinano
  correttamente ed è quello che serve.
"""

import sqlite3
import json
from pathlib import Path
from config import DB_PATH


# ---------------------------------------------------------------------------
# Connessione
# ---------------------------------------------------------------------------
def get_connection():
    """
    Restituisce una connessione SQLite configurata correttamente.

    - row_factory = sqlite3.Row permette di accedere alle colonne per nome
      (row["nome_comune"]) invece che per indice (row[2]), il che rende il
      codice molto più leggibile e robusto ai cambi di schema.

    - PRAGMA foreign_keys = ON va eseguito su OGNI connessione, non è
      un'impostazione persistente del database.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
SCHEMA = """
-- =====================================================================
-- Tabella PIANTE: catalogo delle specie/cultivar coltivate
-- =====================================================================
-- Questa è un'ANAGRAFICA: una riga per ogni tipo di pianta. Se hai 8 vasi
-- di Vinca, qui c'è UNA riga "Vinca" e otto righe in `vasi` che puntano
-- a questa.
CREATE TABLE IF NOT EXISTS piante (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_comune         TEXT    NOT NULL UNIQUE,
    nome_scientifico    TEXT,
    famiglia            TEXT,
    tipo_ambiente       TEXT CHECK(tipo_ambiente IN ('interno','esterno','entrambi')) DEFAULT 'esterno',
    luce                TEXT CHECK(luce IN ('pieno sole','mezz''ombra','ombra','luminoso indiretto')),
    temp_min_c          REAL,    -- temperatura minima tollerata
    temp_max_c          REAL,    -- temperatura massima tollerata
    umidita_ottimale    INTEGER, -- % umidità aria ideale (0-100)
    note                TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
);

-- =====================================================================
-- Tabella SUBSTRATI: catalogo delle miscele di terriccio
-- =====================================================================
-- `composizione` è un JSON del tipo [{"componente":"torba","percentuale":50}, ...]
-- Lo manteniamo JSON perché il numero di componenti è variabile e non vale
-- la pena creare una tabella di giunzione per una feature che leggerai
-- sempre tutta insieme.
-- `whc` (Water Holding Capacity) è un valore 0.0-1.0 che indica quanta
-- acqua il substrato può trattenere rispetto al suo volume. Serve al
-- calcolatore di fertirrigazione.
CREATE TABLE IF NOT EXISTS substrati (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL UNIQUE,
    descrizione     TEXT,
    composizione    TEXT,     -- JSON array di {componente, percentuale}
    whc             REAL,     -- Water Holding Capacity (0.0 - 1.0)
    ph_min          REAL,
    ph_max          REAL,
    drenaggio       INTEGER CHECK(drenaggio BETWEEN 1 AND 10), -- 1=pessimo, 10=eccellente
    preimpostato    INTEGER DEFAULT 0,  -- 1 = creato dal seed, 0 = dall'utente
    note            TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- =====================================================================
-- Tabella FERTILIZZANTI: catalogo dei concimi
-- =====================================================================
CREATE TABLE IF NOT EXISTS fertilizzanti (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL,
    marca           TEXT,
    npk_n           REAL,     -- Azoto (N) in %
    npk_p           REAL,     -- Fosforo (P) in %
    npk_k           REAL,     -- Potassio (K) in %
    tipo            TEXT CHECK(tipo IN ('bio','sintetico','lento rilascio','organico','stimolante')),
    forma           TEXT CHECK(forma IN ('liquido','granulare','polvere','pellet','bastoncino')),
    dosaggio_ml_per_l REAL,   -- ml di prodotto per litro d'acqua (guida)
    preimpostato    INTEGER DEFAULT 0,
    note            TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    -- Un concime è identificato dalla coppia (nome, marca): possono esistere
    -- due "Orchidee" ma di marche diverse (COMPO e Cifo), come nella v1.
    UNIQUE(nome, marca)
);

-- =====================================================================
-- Tabella FITOPATIE: catalogo malattie/parassiti/carenze
-- =====================================================================
CREATE TABLE IF NOT EXISTS fitopatie (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL UNIQUE,
    tipo            TEXT CHECK(tipo IN ('fungina','batterica','virale','parassita','carenza','fisiopatia')),
    sintomi         TEXT,
    prevenzione     TEXT,
    trattamento     TEXT,
    preimpostato    INTEGER DEFAULT 0,
    note            TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- =====================================================================
-- Tabella VASI: gli esemplari/record operativi
-- =====================================================================
-- Questa è la tabella "transazionale": una riga per ogni vaso fisico.
-- Punta a pianta_id e substrato_id delle anagrafiche.
-- I campi dimensionali hanno significato diverso in base alla forma:
--   cilindrico/rotondo:  diametro_sup, (diametro_inf per tronco-conici), altezza
--   quadrato:            lunghezza (= larghezza), altezza
--   rettangolare:        lunghezza, larghezza, altezza
-- Teniamo tutti i campi in una sola tabella con NULL dove non applicabili:
-- creare tabelle separate per ogni forma sarebbe over-engineering.
CREATE TABLE IF NOT EXISTS vasi (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    pianta_id               INTEGER NOT NULL,
    soprannome              TEXT,
    posizione               TEXT CHECK(posizione IN ('interno','esterno','serra','balcone','terrazzo','giardino')) DEFAULT 'esterno',
    esemplari               INTEGER DEFAULT 1 CHECK(esemplari >= 1),

    -- Dimensioni del vaso
    forma                   TEXT CHECK(forma IN ('cilindrico','quadrato','rettangolare','conico','ovale')) DEFAULT 'cilindrico',
    materiale               TEXT CHECK(materiale IN ('plastica','terracotta','ceramica','legno','metallo','fibra','cemento','altro')) DEFAULT 'plastica',
    diametro_sup_cm         REAL,   -- usato per cilindrico/conico/ovale
    diametro_inf_cm         REAL,   -- solo per conico (tronco di cono)
    lunghezza_cm            REAL,   -- usato per quadrato/rettangolare
    larghezza_cm            REAL,   -- solo per rettangolare
    altezza_cm              REAL,
    volume_l                REAL,   -- calcolato lato client ma persistito

    -- Substrato (FK verso anagrafica)
    substrato_id            INTEGER,

    -- Date operative
    data_invaso             TEXT,
    data_ultimo_rinvaso     TEXT,
    data_ultima_annaffiatura TEXT,

    note                    TEXT,
    created_at              TEXT DEFAULT (datetime('now')),
    updated_at              TEXT DEFAULT (datetime('now')),

    -- Vincoli relazionali
    FOREIGN KEY (pianta_id)    REFERENCES piante(id)    ON DELETE RESTRICT,
    FOREIGN KEY (substrato_id) REFERENCES substrati(id) ON DELETE SET NULL
);

-- =====================================================================
-- GIUNZIONE: vasi ↔ fertilizzanti (molti-a-molti)
-- =====================================================================
-- Un vaso può usare N fertilizzanti, un fertilizzante può essere usato in N vasi.
-- La chiave primaria composta (vaso_id, fertilizzante_id) impedisce duplicati.
CREATE TABLE IF NOT EXISTS vasi_fertilizzanti (
    vaso_id          INTEGER NOT NULL,
    fertilizzante_id INTEGER NOT NULL,
    PRIMARY KEY (vaso_id, fertilizzante_id),
    FOREIGN KEY (vaso_id)          REFERENCES vasi(id)          ON DELETE CASCADE,
    FOREIGN KEY (fertilizzante_id) REFERENCES fertilizzanti(id) ON DELETE CASCADE
);

-- =====================================================================
-- FITOPATIE IN CORSO: istanze concrete di malattie/parassiti su un vaso
-- =====================================================================
-- Non è una semplice giunzione perché ha attributi propri (data_inizio,
-- gravità, stato del trattamento). Ogni riga è un EPISODIO: lo stesso
-- vaso può aver avuto la cocciniglia tre volte in tre estati diverse,
-- e vogliamo poterlo tracciare storicamente.
CREATE TABLE IF NOT EXISTS vasi_fitopatie (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    vaso_id               INTEGER NOT NULL,
    fitopatia_id          INTEGER NOT NULL,
    data_inizio           TEXT,
    data_fine             TEXT,   -- NULL = episodio ancora in corso
    gravita               INTEGER CHECK(gravita BETWEEN 1 AND 5),
    trattamento_in_corso  INTEGER DEFAULT 1,
    note                  TEXT,
    created_at            TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vaso_id)      REFERENCES vasi(id)      ON DELETE CASCADE,
    FOREIGN KEY (fitopatia_id) REFERENCES fitopatie(id) ON DELETE CASCADE
);

-- =====================================================================
-- INDICI per query frequenti
-- =====================================================================
-- Questi indici accelerano i JOIN più comuni. SQLite li userebbe anche
-- senza, ma diventano indispensabili quando la tabella `vasi` cresce.
CREATE INDEX IF NOT EXISTS idx_vasi_pianta    ON vasi(pianta_id);
CREATE INDEX IF NOT EXISTS idx_vasi_substrato ON vasi(substrato_id);
CREATE INDEX IF NOT EXISTS idx_vf_vaso        ON vasi_fertilizzanti(vaso_id);
CREATE INDEX IF NOT EXISTS idx_vp_vaso        ON vasi_fitopatie(vaso_id);
CREATE INDEX IF NOT EXISTS idx_vp_attive      ON vasi_fitopatie(vaso_id, data_fine);
"""


# ---------------------------------------------------------------------------
# DATI PREIMPOSTATI
# ---------------------------------------------------------------------------
# Questi sono i cataloghi "di fabbrica" che popoliamo al primo avvio.
# Ho ripreso i fertilizzanti esattamente dallo screenshot della v1.0.
# ---------------------------------------------------------------------------

FERTILIZZANTI_PREIMPOSTATI = [
    # BioBizz (linea bio-organica, molto usata in coltivazione indoor)
    ("Bio·Grow",       "BioBizz",    4.0, 3.0, 6.0,    "bio",            "liquido", 4.0),
    ("Bio·Bloom",      "BioBizz",    2.0, 7.0, 4.0,    "bio",            "liquido", 2.0),
    ("Top·Max",        "BioBizz",    0.1, 0.01, 0.1,   "stimolante",     "liquido", 0.5),
    ("Alg·A·Mic",      "BioBizz",    0.1, 0.1, 0.1,    "stimolante",     "liquido", 2.0),
    ("Fish·Mix",       "BioBizz",    5.0, 1.0, 4.0,    "organico",       "liquido", 2.0),
    ("CalMag",         "BioBizz",    0.0, 0.0, 0.0,    "stimolante",     "liquido", 2.0),
    ("Root·Juice",     "BioBizz",    0.1, 0.1, 0.1,    "stimolante",     "liquido", 2.0),
    ("Worm·Humus",     "BioBizz",    1.0, 0.0, 0.0,    "organico",       "polvere", None),
    # COMPO
    ("Universale",              "COMPO", 7.0,  5.0,  6.0,   "sintetico",       "liquido", 2.0),
    ("Piante verdi",            "COMPO", 7.0,  3.0,  6.0,   "sintetico",       "liquido", 2.0),
    ("Piante fiorite",          "COMPO", 3.0,  5.0,  7.0,   "sintetico",       "liquido", 2.0),
    ("Agrumi e mediterranee",   "COMPO", 6.0,  3.0,  6.0,   "sintetico",       "liquido", 2.0),
    ("Cactus",                  "COMPO", 4.0,  5.0,  7.0,   "sintetico",       "liquido", 2.0),
    ("Bonsai",                  "COMPO", 6.0,  3.0,  6.0,   "sintetico",       "liquido", 2.0),
    ("Orchidee",                "COMPO", 3.0,  6.0,  6.0,   "sintetico",       "liquido", 2.0),
    ("Osmocote universale",     "COMPO", 14.0, 13.0, 13.0,  "lento rilascio",  "granulare", None),
    # Cifo
    ("Granverde universale", "Cifo", 6.0, 5.0, 7.0, "sintetico", "granulare", None),
    ("Granverde fioritura",  "Cifo", 4.0, 6.0, 8.0, "sintetico", "granulare", None),
    ("Sinergon agrumi",      "Cifo", 6.0, 5.0, 5.0, "sintetico", "liquido",   2.0),
    ("Orchidee",             "Cifo", 4.0, 6.0, 6.0, "sintetico", "liquido",   2.0),
    ("Ferro chelato",        "Cifo", 0.0, 0.0, 0.0, "stimolante","polvere",   None),
    # KB/Scotts
    ("Osmocote Smart",    "KB/Scotts", 11.0, 11.0, 18.0, "lento rilascio", "granulare", None),
    ("Universale liquido","KB/Scotts", 7.0,  7.0,  7.0,  "sintetico",      "liquido", 2.0),
    # Biogold (tipico dei bonsai)
    ("Original", "Biogold", 5.5, 6.5, 3.5, "organico",  "pellet", None),
    ("Vital",    "Biogold", 0.0, 0.0, 0.0, "stimolante","liquido", 2.0),
    # Flortis
    ("Universale Bio", "Flortis", 5.0, 5.0, 5.0, "bio", "liquido", 2.0),
    ("Agrumi Bio",     "Flortis", 6.0, 4.0, 5.0, "bio", "liquido", 2.0),
    ("Orchidee",       "Flortis", 3.0, 5.0, 6.0, "bio", "liquido", 2.0),
    # Vigorplant
    ("Fito universale", "Vigorplant", 7.0, 5.0, 6.0, "sintetico", "liquido", 2.0),
    ("Acidofile",       "Vigorplant", 5.0, 3.0, 7.0, "sintetico", "liquido", 2.0),
    # Naturali / ammendanti
    ("Lupini macinati",      "Naturale", 5.0, 0.0, 0.0, "organico", "polvere", None),
    ("Stallatico pellettato","Naturale", 3.0, 3.0, 3.0, "organico", "pellet",  None),
]


SUBSTRATI_PREIMPOSTATI = [
    # (nome, descrizione, composizione_dict, whc, ph_min, ph_max, drenaggio)
    (
        "Universale",
        "Miscela generica per la maggior parte delle piante da appartamento e da balcone.",
        [{"componente": "terriccio universale", "percentuale": 50},
         {"componente": "perlite",              "percentuale": 30},
         {"componente": "pomice",               "percentuale": 20}],
        0.45, 6.0, 7.0, 7,
    ),
    (
        "Cactacee e succulente",
        "Miscela molto drenante per piante grasse, con alta componente minerale.",
        [{"componente": "sabbia silicea",       "percentuale": 40},
         {"componente": "pomice",               "percentuale": 30},
         {"componente": "terriccio universale", "percentuale": 20},
         {"componente": "perlite",              "percentuale": 10}],
        0.25, 6.0, 7.5, 10,
    ),
    (
        "Acidofile",
        "Per piante che richiedono pH acido: azalee, rododendri, ortensie blu, camelie, mirtilli.",
        [{"componente": "torba acida",       "percentuale": 70},
         {"componente": "perlite",           "percentuale": 20},
         {"componente": "pomice",            "percentuale": 10}],
        0.55, 4.5, 5.5, 7,
    ),
    (
        "Orchidee epifite",
        "Substrato aerato a base di corteccia, per Phalaenopsis, Cattleya e affini.",
        [{"componente": "corteccia di pino (bark)", "percentuale": 70},
         {"componente": "perlite",                   "percentuale": 20},
         {"componente": "sfagno",                    "percentuale": 10}],
        0.30, 5.5, 6.5, 9,
    ),
    (
        "Bonsai classico",
        "Miscela giapponese tradizionale per conifere e latifoglie.",
        [{"componente": "akadama", "percentuale": 50},
         {"componente": "kiryu",   "percentuale": 25},
         {"componente": "lapillo", "percentuale": 25}],
        0.35, 6.0, 7.0, 9,
    ),
    (
        "Agrumi e mediterranee",
        "Per limoni, aranci, olivi: buon drenaggio e buona ritenzione.",
        [{"componente": "terriccio universale", "percentuale": 50},
         {"componente": "pomice",               "percentuale": 25},
         {"componente": "perlite",              "percentuale": 15},
         {"componente": "stallatico maturo",    "percentuale": 10}],
        0.40, 6.0, 7.0, 8,
    ),
    (
        "Aromatiche",
        "Per rosmarino, salvia, timo, lavanda: drenante e poco ricco.",
        [{"componente": "terriccio universale", "percentuale": 50},
         {"componente": "sabbia",               "percentuale": 30},
         {"componente": "perlite",              "percentuale": 20}],
        0.35, 6.5, 7.5, 9,
    ),
    (
        "Semina",
        "Miscela fine e sterile per semenzaio.",
        [{"componente": "torba bionda", "percentuale": 60},
         {"componente": "perlite fine", "percentuale": 25},
         {"componente": "vermiculite",  "percentuale": 15}],
        0.60, 5.5, 6.5, 6,
    ),
]


FITOPATIE_PREIMPOSTATE = [
    # (nome, tipo, sintomi, prevenzione, trattamento)
    ("Oidio", "fungina",
     "Patina biancastra e farinosa su foglie e germogli, ingiallimento e disseccamento.",
     "Evitare ristagni di umidità, garantire ventilazione, irrigare al piede.",
     "Zolfo bagnabile o bicarbonato di potassio; in casi gravi fungicidi sistemici."),

    ("Peronospora", "fungina",
     "Macchie giallastre sulla pagina superiore, muffa grigio-violacea sulla pagina inferiore.",
     "Evitare bagnature fogliari, distanze di impianto adeguate, rotazioni colturali.",
     "Prodotti rameici (poltiglia bordolese); fungicidi sistemici nei casi avanzati."),

    ("Botrite (muffa grigia)", "fungina",
     "Muffa grigia su fiori, foglie e frutti, marciumi molli.",
     "Rimozione parti secche, ventilazione, evitare eccessi di azoto.",
     "Fungicidi a base di rame, zolfo o prodotti specifici; rimuovere tempestivamente parti colpite."),

    ("Afidi", "parassita",
     "Colonie di piccoli insetti verdi/neri su germogli e boccioli, melata appiccicosa, fumaggine.",
     "Controlli frequenti, attirare ausiliari (coccinelle), pacciamature.",
     "Sapone molle potassico, olio di neem, piretro naturale; nei casi gravi aficidi sistemici."),

    ("Cocciniglia cotonosa", "parassita",
     "Masserelle biancastre simili a cotone su fusti e ascelle fogliari, melata, deperimento.",
     "Evitare ambienti troppo secchi (indoor), ispezioni regolari.",
     "Alcool denaturato su cotton-fioc, olio bianco, olio di neem; sistemici per infestazioni estese."),

    ("Cocciniglia a scudetto", "parassita",
     "Scudetti bruno-rossastri sulle foglie e sui rami, ingiallimenti, caduta foglie.",
     "Ispezione regolare delle piante nuove prima dell'introduzione.",
     "Rimozione meccanica, olio bianco in sospensione invernale, insetticidi sistemici."),

    ("Ragnetto rosso", "parassita",
     "Puntinature giallastre sulle foglie, sottili ragnatele, defogliazione.",
     "Aumentare l'umidità ambientale, nebulizzazioni frequenti.",
     "Acaricidi specifici, olio di neem, predatori (Phytoseiulus persimilis)."),

    ("Mosca bianca (aleurodide)", "parassita",
     "Piccoli insetti bianchi che volano alla minima sollecitazione, melata, fumaggine.",
     "Trappole cromotropiche gialle, rotazioni, pulizia delle foglie.",
     "Olio di neem, piretro, insetticidi sistemici; introduzione di Encarsia formosa in serra."),

    ("Clorosi ferrica", "carenza",
     "Ingiallimento internervale delle foglie giovani, nervature che restano verdi.",
     "Evitare substrati troppo calcarei, acqua di irrigazione non troppo dura.",
     "Somministrazione di ferro chelato (EDDHA per substrati con pH alto)."),

    ("Carenza di azoto", "carenza",
     "Ingiallimento uniforme delle foglie vecchie, crescita rallentata.",
     "Concimazione azotata regolare nella stagione vegetativa.",
     "Concime azotato a pronto effetto; fertirrigazione con prodotti ad alto N."),

    ("Marciume radicale", "fisiopatia",
     "Appassimento generale nonostante terreno bagnato, radici scure e molli, odore stagnante.",
     "Drenaggio corretto, sottovaso vuotato, non eccedere con le irrigazioni.",
     "Rinvaso con substrato nuovo, rimozione radici marce, fungicidi rameici in prevenzione."),

    ("Scottature solari", "fisiopatia",
     "Macchie brune o scolorite sulle foglie più esposte, spesso dopo spostamenti.",
     "Acclimatare gradualmente le piante al sole diretto; ombreggiare nei giorni più caldi.",
     "Rimuovere foglie gravemente danneggiate; spostare la pianta in posizione più adatta."),
]


# Piante di esempio: un piccolo catalogo per partire. L'utente ne aggiungerà
# delle proprie via interfaccia. Metto solo quelle più plausibili per un
# giardino italiano, lasciando i dati scheda vuoti dove non significativi.
PIANTE_INIZIALI = [
    # (nome_comune, nome_scientifico, famiglia, tipo_ambiente, luce, temp_min, temp_max, umidita, note)
    ("Vinca",        "Catharanthus roseus",  "Apocynaceae",   "esterno",  "pieno sole",         5,   35, 50, "Fioritura abbondante estiva, ama il caldo."),
    ("Ficus",        "Ficus benjamina",      "Moraceae",      "interno",  "luminoso indiretto", 12,  30, 60, "Sensibile agli sbalzi termici e alle correnti d'aria."),
    ("Oleandro",     "Nerium oleander",      "Apocynaceae",   "esterno",  "pieno sole",         -5,  40, 40, "Rustico, tossico per ingestione. Fioritura estiva."),
    ("Limone",       "Citrus × limon",       "Rutaceae",      "esterno",  "pieno sole",         3,   35, 55, "Temere le gelate sotto -2°C; riparare in inverno."),
    ("Rosmarino",    "Salvia rosmarinus",    "Lamiaceae",     "esterno",  "pieno sole",         -10, 40, 40, "Aromatico rustico, teme solo i ristagni idrici."),
    ("Lavanda",      "Lavandula angustifolia","Lamiaceae",    "esterno",  "pieno sole",         -15, 35, 40, "Terreno drenante obbligatorio, poca acqua."),
    ("Basilico",     "Ocimum basilicum",     "Lamiaceae",     "esterno",  "pieno sole",         10,  35, 55, "Annuale; pinzare gli apici per infoltirlo."),
    ("Orchidea Phalaenopsis", "Phalaenopsis spp.", "Orchidaceae", "interno", "luminoso indiretto", 16, 28, 70, "Epifita; substrato bark, irrigazione per immersione."),
    ("Azalea",       "Rhododendron simsii",  "Ericaceae",     "entrambi", "mezz'ombra",         0,   25, 65, "Acidofila; usare acqua non calcarea."),
    ("Ciclamino",    "Cyclamen persicum",    "Primulaceae",   "entrambi", "luminoso indiretto", 5,   20, 60, "Fioritura autunno/inverno; riposo estivo."),
]


# ---------------------------------------------------------------------------
# Inizializzazione e seed
# ---------------------------------------------------------------------------
def init_db():
    """
    Crea tabelle e indici se non esistono. Idempotente: chiamarlo più volte
    non causa danni.
    """
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def seed_if_empty():
    """
    Inserisce i dati preimpostati solo se le tabelle sono vuote.

    Controlliamo tabella per tabella: così se l'utente cancella tutti i
    fertilizzanti di proposito, al prossimo riavvio NON glieli rimettiamo.
    (Il check è "vuota? -> seed". Se l'utente ha almeno un record, assumiamo
    abbia deciso lui.)
    """
    conn = get_connection()
    try:
        # Fertilizzanti
        count = conn.execute("SELECT COUNT(*) FROM fertilizzanti").fetchone()[0]
        if count == 0:
            conn.executemany(
                """INSERT INTO fertilizzanti
                   (nome, marca, npk_n, npk_p, npk_k, tipo, forma, dosaggio_ml_per_l, preimpostato)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                FERTILIZZANTI_PREIMPOSTATI,
            )
            print(f"[seed] Inseriti {len(FERTILIZZANTI_PREIMPOSTATI)} fertilizzanti.")

        # Substrati
        count = conn.execute("SELECT COUNT(*) FROM substrati").fetchone()[0]
        if count == 0:
            for nome, desc, comp, whc, ph_min, ph_max, drenaggio in SUBSTRATI_PREIMPOSTATI:
                conn.execute(
                    """INSERT INTO substrati
                       (nome, descrizione, composizione, whc, ph_min, ph_max, drenaggio, preimpostato)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
                    (nome, desc, json.dumps(comp, ensure_ascii=False), whc, ph_min, ph_max, drenaggio),
                )
            print(f"[seed] Inseriti {len(SUBSTRATI_PREIMPOSTATI)} substrati.")

        # Fitopatie
        count = conn.execute("SELECT COUNT(*) FROM fitopatie").fetchone()[0]
        if count == 0:
            conn.executemany(
                """INSERT INTO fitopatie
                   (nome, tipo, sintomi, prevenzione, trattamento, preimpostato)
                   VALUES (?, ?, ?, ?, ?, 1)""",
                FITOPATIE_PREIMPOSTATE,
            )
            print(f"[seed] Inserite {len(FITOPATIE_PREIMPOSTATE)} fitopatie.")

        # Piante (anagrafica iniziale)
        count = conn.execute("SELECT COUNT(*) FROM piante").fetchone()[0]
        if count == 0:
            conn.executemany(
                """INSERT INTO piante
                   (nome_comune, nome_scientifico, famiglia, tipo_ambiente,
                    luce, temp_min_c, temp_max_c, umidita_ottimale, note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                PIANTE_INIZIALI,
            )
            print(f"[seed] Inserite {len(PIANTE_INIZIALI)} piante di esempio.")

        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    # Eseguire `python database.py` per (re)inizializzare lo schema e i seed.
    init_db()
    seed_if_empty()
    print("Database pronto:", DB_PATH)
