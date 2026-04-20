/* ============================================================
   app.js - Nucleo dell'applicazione
   ============================================================
   Espone un oggetto globale `app` con:

   - api:     wrapper su fetch() per parlare col backend
   - modal:   apertura/chiusura del modal condiviso
   - toast:   notifiche brevi a fondo pagina
   - tabs:    gestione tab principali e tab interne
   - cache:   piccola cache in memoria delle anagrafiche
              (evita di ri-scaricare fertilizzanti/substrati ogni volta
              che apri il form di un vaso)
   - moduli:  slot dove piante.js, vasi.js e tabelle.js si registrano

   Filosofia: niente framework, niente bundler. Solo vanilla JS moderno
   (ES2020+). Tutto ciò che serve a un modulo per funzionare è dichiarato
   qui sopra una volta per tutte.
   ============================================================ */

(function () {
  "use strict";

  // ----------------------------------------------------------------
  // API helper
  // ----------------------------------------------------------------
  // Avvolgiamo fetch() in un piccolo oggetto che:
  // - compone l'URL col prefisso /api
  // - serializza/deserializza JSON
  // - solleva errori leggibili quando il server risponde != 2xx
  //
  // Gli errori finiscono automaticamente in un toast rosso grazie al
  // try/catch nei chiamanti.
  // ----------------------------------------------------------------
  const api = {
    async _fetch(method, path, body) {
      const options = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) options.body = JSON.stringify(body);

      const res = await fetch("/api" + path, options);
      // 204 No Content o body vuoto -> null
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;

      if (!res.ok) {
        // Il server manda {error: "..."} per ogni risposta di errore.
        const msg = data?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    },

    get(path)        { return this._fetch("GET",    path); },
    post(path, body) { return this._fetch("POST",   path, body); },
    put(path, body)  { return this._fetch("PUT",    path, body); },
    del(path)        { return this._fetch("DELETE", path); },
  };

  // ----------------------------------------------------------------
  // Toast
  // ----------------------------------------------------------------
  // Notifica di 2 secondi a fondo schermo. Il timeout viene resettato
  // se chiamiamo toast() mentre uno è già visibile, così l'ultimo
  // messaggio "vince" invece di accodarsi.
  // ----------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, tipo = "ok") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (tipo === "errore" ? " errore" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("nascosto"), 2500);
  }

  // ----------------------------------------------------------------
  // Modal
  // ----------------------------------------------------------------
  // Un solo overlay in index.html, popolato dal chiamante con HTML
  // arbitrario. I moduli costruiscono il proprio form e lo passano a
  // modal.apri(). modal.chiudi() lo nasconde e svuota il contenuto.
  //
  // Supporta:
  //   - chiusura con il pulsante "×" del modal
  //   - chiusura cliccando FUORI dal modal (sull'overlay)
  //   - chiusura con il tasto ESC da tastiera
  // ----------------------------------------------------------------
  const modalOverlay = document.getElementById("modal-overlay");
  const modalContenuto = document.getElementById("modal-contenuto");

  const modal = {
    apri(html) {
      modalContenuto.innerHTML = html;
      modalOverlay.classList.remove("nascosto");
      // Scroll al top del modal (se era aperto in precedenza su altro contenuto)
      modalContenuto.scrollTop = 0;
    },
    chiudi() {
      modalOverlay.classList.add("nascosto");
      modalContenuto.innerHTML = "";
    },
    // Il chiamante può collegare callback custom al submit del form
    // interno. Tipicamente ciascun modulo lo fa dopo aver iniettato
    // il proprio HTML.
  };

  // Chiusura cliccando sull'overlay (ma non sul contenuto interno)
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) modal.chiudi();
  });

  // Chiusura con ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.classList.contains("nascosto")) {
      modal.chiudi();
    }
  });

  // ----------------------------------------------------------------
  // Router: tab principali
  // ----------------------------------------------------------------
  // Cliccando un bottone della tab-bar, mostriamo la sezione
  // corrispondente e nascondiamo le altre. Invochiamo anche la
  // render() del modulo associato se esiste, così al primo ingresso
  // vediamo i dati aggiornati.
  // ----------------------------------------------------------------
  function mostraSezione(nome) {
    document.querySelectorAll(".sezione").forEach((s) => s.classList.remove("attiva"));
    document.querySelectorAll(".tab-bar-btn").forEach((b) => b.classList.remove("attiva"));

    document.getElementById(`sezione-${nome}`)?.classList.add("attiva");
    document.querySelector(`.tab-bar-btn[data-sezione="${nome}"]`)?.classList.add("attiva");

    // Aggiorna il sottotitolo dell'header
    const sottotitoli = {
      piante:   "Catalogo delle specie coltivate",
      vasi:     "Esemplari e fertirrigazione",
      tabelle:  "Fertilizzanti · Substrati · Fitopatie",
    };
    const sub = document.getElementById("sottotitolo-app");
    if (sub) sub.textContent = sottotitoli[nome] || "";

    // Chiediamo al modulo di aggiornare la sua UI
    app.moduli[nome]?.render?.();
  }

  document.querySelectorAll(".tab-bar-btn").forEach((btn) => {
    btn.addEventListener("click", () => mostraSezione(btn.dataset.sezione));
  });

  // ----------------------------------------------------------------
  // Tab interne (dentro "Tabelle")
  // ----------------------------------------------------------------
  function mostraTabella(nome) {
    document.querySelectorAll(".tab-interna").forEach((b) => b.classList.remove("attiva"));
    document.querySelectorAll(".pannello-tabella").forEach((p) => p.classList.remove("attivo"));

    document.querySelector(`.tab-interna[data-tabella="${nome}"]`)?.classList.add("attiva");
    document.getElementById(`pannello-${nome}`)?.classList.add("attivo");

    // Richiama il render del modulo giusto
    app.moduli.tabelle?.renderTabella?.(nome);
  }

  document.querySelectorAll(".tab-interna").forEach((btn) => {
    btn.addEventListener("click", () => mostraTabella(btn.dataset.tabella));
  });

  // ----------------------------------------------------------------
  // Helper di utilità comuni ai moduli
  // ----------------------------------------------------------------

  /**
   * Escapa HTML per prevenire XSS quando iniettiamo stringhe utente
   * dentro innerHTML. Usiamo una textarea come trick di decoding/encoding
   * nativo del browser, che copre tutti i casi edge.
   */
  function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  /**
   * Normalizza una stringa per la ricerca: minuscolo + trim + rimozione
   * accenti. Così "Phalænopsis" matcha anche con "phalaenopsis".
   */
  function normalizza(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  /**
   * Conferma con dialog nativo. Lo wrappo qui così in futuro posso
   * sostituirlo con un dialog custom senza toccare i moduli.
   */
  function conferma(messaggio) {
    return window.confirm(messaggio);
  }

  /**
   * Formatta un NPK in stringa breve. npk(4,3,6) -> "4-3-6"
   */
  function formatNPK(n, p, k) {
    const fmt = (v) => (v == null ? "?" : String(v));
    return `${fmt(n)}-${fmt(p)}-${fmt(k)}`;
  }

  // ----------------------------------------------------------------
  // Cache anagrafiche
  // ----------------------------------------------------------------
  // Piante, fertilizzanti, substrati e fitopatie vengono usati spesso
  // dai form dei vasi. Li carichiamo una volta e li teniamo in memoria,
  // invalidando la cache quando qualcosa cambia.
  // ----------------------------------------------------------------
  const cache = {
    piante:        null,
    fertilizzanti: null,
    substrati:     null,
    fitopatie:     null,
    componenti:    null,

    async carica(nome, force = false) {
      if (!force && this[nome]) return this[nome];
      this[nome] = await api.get("/" + nome);
      return this[nome];
    },

    invalida(nome) {
      this[nome] = null;
    },

    invalidaTutto() {
      this.piante = this.fertilizzanti = this.substrati = this.fitopatie = this.componenti = null;
    },
  };

  // ----------------------------------------------------------------
  // Export su window.app
  // ----------------------------------------------------------------
  window.app = {
    api,
    modal,
    toast,
    mostraSezione,
    mostraTabella,
    escapeHtml,
    normalizza,
    conferma,
    formatNPK,
    cache,
    // Slot per i moduli che si registrano
    moduli: {},
  };

  // Al primo load mostriamo la sezione "piante" (già attiva via HTML,
  // ma chiamiamo mostraSezione per far girare il render del modulo).
  document.addEventListener("DOMContentLoaded", () => {
    mostraSezione("piante");
  });
})();
