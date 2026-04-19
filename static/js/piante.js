/* ============================================================
   piante.js - Modulo "Le Mie Piante"
   ============================================================
   Gestisce la lista di piante (anagrafica) e il form di
   inserimento/modifica. Si registra in app.moduli.piante così
   quando l'utente clicca sulla tab "Piante", app.mostraSezione()
   chiama il nostro render().

   Struttura del modulo (ricorre anche in vasi.js e tabelle.js):
   1. Stato locale (la lista cached e il filtro di ricerca)
   2. render():     ricarica i dati e ricostruisce la lista
   3. apriForm():   costruisce l'HTML del form e lo passa al modal
   4. salva():      legge i valori, chiama l'API, aggiorna la UI
   5. elimina():    chiede conferma e chiama DELETE
   ============================================================ */

(function () {
  "use strict";

  // Stato locale del modulo
  let piante = [];
  let filtro = "";

  // DOM references usati ripetutamente
  const lista = document.getElementById("lista-piante");
  const inputRicerca = document.getElementById("ricerca-piante");

  // ----------------------------------------------------------------
  // Rendering della lista
  // ----------------------------------------------------------------
  // Due responsabilità:
  //  - scaricare i dati freschi dal server
  //  - filtrarli in memoria secondo il testo di ricerca
  // ----------------------------------------------------------------
  async function render() {
    try {
      piante = await app.cache.carica("piante", true); // sempre fresco
      disegnaLista();
    } catch (e) {
      app.toast("Errore nel caricamento piante: " + e.message, "errore");
    }
  }

  // Ridisegna soltanto la DOM list (senza rifare fetch): utile quando
  // cambia il filtro di ricerca o dopo una modifica locale.
  function disegnaLista() {
    const q = app.normalizza(filtro);
    const visibili = piante.filter((p) => {
      if (!q) return true;
      return (
        app.normalizza(p.nome_comune).includes(q) ||
        app.normalizza(p.nome_scientifico).includes(q) ||
        app.normalizza(p.famiglia).includes(q)
      );
    });

    if (visibili.length === 0) {
      lista.innerHTML = `<div class="lista-vuota">
        ${piante.length === 0
          ? "Nessuna pianta in catalogo. Clicca <strong>+ Aggiungi pianta</strong> per iniziare."
          : "Nessuna pianta corrisponde alla ricerca."}
      </div>`;
      return;
    }

    // Card per ogni pianta. Usiamo escapeHtml su tutti i campi utente
    // per evitare XSS se qualcuno mettesse <script> in un soprannome.
    lista.innerHTML = visibili
      .map((p) => `
        <div class="card" data-id="${p.id}">
          <div class="card-header">
            <div>
              <h3 class="card-titolo">${app.escapeHtml(p.nome_comune)}</h3>
              ${p.nome_scientifico
                ? `<div class="card-sottotitolo">${app.escapeHtml(p.nome_scientifico)}</div>`
                : ""}
            </div>
            <div class="card-azioni">
              <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
              <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
            </div>
          </div>
          <div class="card-meta">
            ${p.famiglia ? `<span class="chip alt">${app.escapeHtml(p.famiglia)}</span>` : ""}
            <span class="chip">${app.escapeHtml(p.tipo_ambiente || "esterno")}</span>
            ${p.luce ? `<span class="chip info">${app.escapeHtml(p.luce)}</span>` : ""}
            ${(p.temp_min_c != null && p.temp_max_c != null)
              ? `<span class="chip">${p.temp_min_c}°C / ${p.temp_max_c}°C</span>`
              : ""}
          </div>
          ${p.note ? `<div class="muted" style="margin-top:8px;font-size:.85rem">${app.escapeHtml(p.note)}</div>` : ""}
        </div>
      `)
      .join("");

    // Delego i click sulle card azioni via event delegation
    // (più efficiente che attaccare un listener per ogni bottone).
    lista.querySelectorAll(".card").forEach((card) => {
      const id = Number(card.dataset.id);
      card.querySelector('[data-azione="modifica"]').addEventListener("click", () => {
        const pianta = piante.find((x) => x.id === id);
        apriForm(pianta);
      });
      card.querySelector('[data-azione="elimina"]').addEventListener("click", () => {
        elimina(id);
      });
    });
  }

  // ----------------------------------------------------------------
  // Form (insert / edit)
  // ----------------------------------------------------------------
  // Se `pianta` è undefined, è un inserimento. Altrimenti precompilo
  // i campi con i valori esistenti.
  // ----------------------------------------------------------------
  function apriForm(pianta) {
    const p = pianta || {};

    const html = `
      <div class="modal-header">
        <h2 class="modal-titolo">${pianta ? "Modifica pianta" : "Nuova pianta"}</h2>
        <button class="btn-chiudi" id="chiudi-modal-pianta">×</button>
      </div>

      <form id="form-pianta">
        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">🌿 Identificazione</h3>
          <div class="form-grid">
            <div class="campo full">
              <label for="fp-nome-comune">Nome comune *</label>
              <input id="fp-nome-comune" name="nome_comune" required
                     placeholder="Es: Vinca, Ficus..."
                     value="${app.escapeHtml(p.nome_comune)}" />
            </div>
            <div class="campo full">
              <label for="fp-nome-scientifico">Nome scientifico</label>
              <input id="fp-nome-scientifico" name="nome_scientifico"
                     placeholder="Es: Catharanthus roseus"
                     value="${app.escapeHtml(p.nome_scientifico)}" />
            </div>
            <div class="campo">
              <label for="fp-famiglia">Famiglia</label>
              <input id="fp-famiglia" name="famiglia"
                     placeholder="Es: Apocynaceae"
                     value="${app.escapeHtml(p.famiglia)}" />
            </div>
            <div class="campo">
              <label for="fp-ambiente">Ambiente</label>
              <select id="fp-ambiente" name="tipo_ambiente">
                ${opzioni(["esterno","interno","entrambi"], p.tipo_ambiente || "esterno")}
              </select>
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">☀️ Condizioni ottimali</h3>
          <div class="form-grid">
            <div class="campo full">
              <label for="fp-luce">Esposizione luminosa</label>
              <select id="fp-luce" name="luce">
                <option value="">—</option>
                ${opzioni(
                  ["pieno sole","mezz'ombra","ombra","luminoso indiretto"],
                  p.luce
                )}
              </select>
            </div>
            <div class="campo">
              <label for="fp-tmin">Temp. min (°C)</label>
              <input id="fp-tmin" name="temp_min_c" type="number" step="0.5"
                     value="${valOrEmpty(p.temp_min_c)}" />
            </div>
            <div class="campo">
              <label for="fp-tmax">Temp. max (°C)</label>
              <input id="fp-tmax" name="temp_max_c" type="number" step="0.5"
                     value="${valOrEmpty(p.temp_max_c)}" />
            </div>
            <div class="campo full">
              <label for="fp-umid">Umidità ottimale (%)</label>
              <input id="fp-umid" name="umidita_ottimale" type="number" min="0" max="100"
                     value="${valOrEmpty(p.umidita_ottimale)}" />
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">📝 Note</h3>
          <div class="campo">
            <textarea name="note" placeholder="Annotazioni libere sulla specie...">${app.escapeHtml(p.note)}</textarea>
          </div>
        </div>

        <div class="azioni-form">
          <button type="button" class="btn-secondario" id="btn-annulla-pianta">Annulla</button>
          <button type="submit" class="btn-primario">${pianta ? "Aggiorna" : "Crea pianta"}</button>
        </div>
      </form>
    `;

    app.modal.apri(html);

    // Handler chiusura (sia ×, sia "Annulla")
    document.getElementById("chiudi-modal-pianta").onclick = app.modal.chiudi;
    document.getElementById("btn-annulla-pianta").onclick = app.modal.chiudi;

    // Handler submit
    document.getElementById("form-pianta").addEventListener("submit", (e) => {
      e.preventDefault();
      salva(e.target, pianta?.id);
    });
  }

  // ----------------------------------------------------------------
  // Helpers interni
  // ----------------------------------------------------------------
  // Genera <option> HTML selezionando quella attuale.
  function opzioni(lista, attuale) {
    return lista
      .map((v) => `<option value="${app.escapeHtml(v)}" ${v === attuale ? "selected" : ""}>${app.escapeHtml(v)}</option>`)
      .join("");
  }
  function valOrEmpty(v) { return v == null || v === "" ? "" : v; }

  // ----------------------------------------------------------------
  // Salvataggio
  // ----------------------------------------------------------------
  async function salva(form, id) {
    // Costruiamo il payload dai campi del form. `FormData` semplifica la
    // lettura, ma convertiamo manualmente i numerici perché FormData li
    // restituisce sempre come stringhe e il backend SQLite si aspetta
    // numeri reali (o null).
    const fd = new FormData(form);
    const data = {
      nome_comune:      fd.get("nome_comune")?.trim(),
      nome_scientifico: fd.get("nome_scientifico")?.trim() || null,
      famiglia:         fd.get("famiglia")?.trim() || null,
      tipo_ambiente:    fd.get("tipo_ambiente") || "esterno",
      luce:             fd.get("luce") || null,
      temp_min_c:       numOrNull(fd.get("temp_min_c")),
      temp_max_c:       numOrNull(fd.get("temp_max_c")),
      umidita_ottimale: numOrNull(fd.get("umidita_ottimale")),
      note:             fd.get("note")?.trim() || null,
    };

    if (!data.nome_comune) {
      app.toast("Il nome comune è obbligatorio", "errore");
      return;
    }

    try {
      if (id) {
        await app.api.put("/piante/" + id, data);
        app.toast("Pianta aggiornata");
      } else {
        await app.api.post("/piante", data);
        app.toast("Pianta creata");
      }
      app.modal.chiudi();
      app.cache.invalida("piante");
      await render();
    } catch (e) {
      app.toast("Errore nel salvataggio: " + e.message, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Eliminazione
  // ----------------------------------------------------------------
  // La FK dei vasi è ON DELETE RESTRICT: se la pianta ha vasi associati,
  // il server risponde 409 Conflict e noi mostriamo un errore esplicito.
  // ----------------------------------------------------------------
  async function elimina(id) {
    const p = piante.find((x) => x.id === id);
    if (!p) return;
    if (!app.conferma(`Eliminare "${p.nome_comune}"? Non sarà possibile se ci sono vasi associati.`)) return;

    try {
      await app.api.del("/piante/" + id);
      app.toast("Pianta eliminata");
      app.cache.invalida("piante");
      await render();
    } catch (e) {
      // Messaggio specifico per il caso dei vasi associati
      if (e.message.includes("integrità") || e.message.includes("FOREIGN KEY")) {
        app.toast("Impossibile eliminare: ci sono vasi che usano questa pianta", "errore");
      } else {
        app.toast("Errore: " + e.message, "errore");
      }
    }
  }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ----------------------------------------------------------------
  // Wiring degli eventi della sezione
  // ----------------------------------------------------------------
  document.getElementById("btn-aggiungi-pianta").addEventListener("click", () => apriForm());

  inputRicerca.addEventListener("input", (e) => {
    filtro = e.target.value;
    disegnaLista();  // filtraggio in memoria, senza nuovo fetch
  });

  // Registrazione del modulo presso app
  window.app.moduli.piante = { render };
})();
