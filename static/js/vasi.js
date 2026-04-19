/* ============================================================
   vasi.js - Modulo "I Miei Vasi"
   ============================================================
   Questo modulo replica il form della v1.0 mostrato negli screenshot,
   ma salvando tutto su DB tramite l'API backend.

   Punti interessanti dell'implementazione:

   1. CAMPI DIMENSIONALI CONDIZIONALI
      A seconda della forma (cilindrico, quadrato, rettangolare, conico,
      ovale) mostriamo solo i campi rilevanti. Cambiare la tendina "Forma"
      rigenera al volo il gruppo dimensioni.

   2. CALCOLO AUTOMATICO DEL VOLUME
      Appena l'utente compila le misure, calcoliamo il volume in litri
      con le formule geometriche. L'utente può comunque sovrascrivere
      manualmente il valore (utile per vasi di forma irregolare).

   3. MULTI-SELECT FERTILIZZANTI A CHIP
      Al posto di un <select multiple>, usiamo chip cliccabili che
      togglano la classe "selezionato". Più ergonomico su mobile.
      Include una barra di ricerca per filtrare l'elenco quando cresce.
   ============================================================ */

(function () {
  "use strict";

  // Stato locale del modulo
  let vasi = [];
  let filtro = "";
  // Dentro il form teniamo traccia di ids dei fertilizzanti selezionati
  let selFertilizzanti = new Set();
  // E delle nuove fitopatie aggiunte al vaso corrente
  let nuoveFitopatie = [];

  // DOM references
  const lista = document.getElementById("lista-vasi");
  const inputRicerca = document.getElementById("ricerca-vasi");

  // ----------------------------------------------------------------
  // Render della lista
  // ----------------------------------------------------------------
  async function render() {
    try {
      // Qui NON usiamo la cache: la lista dei vasi cambia spesso
      // (ogni annaffiatura registrata farà un update).
      vasi = await app.api.get("/vasi");
      disegnaLista();
    } catch (e) {
      app.toast("Errore nel caricamento vasi: " + e.message, "errore");
    }
  }

  function disegnaLista() {
    const q = app.normalizza(filtro);
    const visibili = vasi.filter((v) => {
      if (!q) return true;
      return (
        app.normalizza(v.pianta_nome).includes(q) ||
        app.normalizza(v.soprannome).includes(q) ||
        app.normalizza(v.pianta_nome_scientifico).includes(q)
      );
    });

    if (visibili.length === 0) {
      lista.innerHTML = `<div class="lista-vuota">
        ${vasi.length === 0
          ? "Nessun vaso registrato. Clicca <strong>+ Aggiungi vaso</strong> per cominciare."
          : "Nessun vaso corrisponde alla ricerca."}
      </div>`;
      return;
    }

    lista.innerHTML = visibili.map(cardVaso).join("");
    lista.querySelectorAll(".card").forEach((card) => {
      const id = Number(card.dataset.id);
      card.querySelector('[data-azione="modifica"]').addEventListener("click", () => apriForm(id));
      card.querySelector('[data-azione="elimina"]').addEventListener("click", () => elimina(id));
    });
  }

  function cardVaso(v) {
    // Costruisce una descrizione compatta delle dimensioni
    const dim = descriviDimensioni(v);
    const vol = v.volume_l ? `${Number(v.volume_l).toFixed(1)} L` : "";

    const titolo = v.soprannome
      ? `${app.escapeHtml(v.pianta_nome)} · ${app.escapeHtml(v.soprannome)}`
      : app.escapeHtml(v.pianta_nome);

    return `
      <div class="card" data-id="${v.id}">
        <div class="card-header">
          <div>
            <h3 class="card-titolo">${titolo}</h3>
            ${v.pianta_nome_scientifico
              ? `<div class="card-sottotitolo">${app.escapeHtml(v.pianta_nome_scientifico)}</div>`
              : ""}
          </div>
          <div class="card-azioni">
            <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
          </div>
        </div>
        <div class="card-meta">
          <span class="chip">${app.escapeHtml(v.forma || "cilindrico")}</span>
          <span class="chip alt">${app.escapeHtml(v.materiale || "plastica")}</span>
          <span class="chip">${app.escapeHtml(v.posizione || "esterno")}</span>
          ${v.esemplari && v.esemplari > 1
            ? `<span class="chip info">${v.esemplari} esemplari</span>` : ""}
          ${dim ? `<span class="chip">${dim}</span>` : ""}
          ${vol ? `<span class="chip info">${vol}</span>` : ""}
          ${v.substrato_nome
            ? `<span class="chip alt">🪨 ${app.escapeHtml(v.substrato_nome)}</span>` : ""}
        </div>
      </div>
    `;
  }

  function descriviDimensioni(v) {
    switch (v.forma) {
      case "quadrato":
        return v.lunghezza_cm && v.altezza_cm
          ? `${v.lunghezza_cm}×${v.lunghezza_cm}×${v.altezza_cm} cm` : "";
      case "rettangolare":
        return v.lunghezza_cm && v.larghezza_cm && v.altezza_cm
          ? `${v.lunghezza_cm}×${v.larghezza_cm}×${v.altezza_cm} cm` : "";
      case "conico":
        return v.diametro_sup_cm && v.diametro_inf_cm && v.altezza_cm
          ? `Ø ${v.diametro_sup_cm}→${v.diametro_inf_cm} × h${v.altezza_cm} cm` : "";
      case "ovale":
      case "cilindrico":
      default:
        return v.diametro_sup_cm && v.altezza_cm
          ? `Ø${v.diametro_sup_cm} × h${v.altezza_cm} cm` : "";
    }
  }

  // ----------------------------------------------------------------
  // Form (insert / edit)
  // ----------------------------------------------------------------
  async function apriForm(id) {
    // Carichiamo in parallelo tutte le anagrafiche che servono ai <select>
    // e il vaso stesso se siamo in modifica.
    try {
      const [piante, fertilizzanti, substrati, fitopatie, vaso] = await Promise.all([
        app.cache.carica("piante"),
        app.cache.carica("fertilizzanti"),
        app.cache.carica("substrati"),
        app.cache.carica("fitopatie"),
        id ? app.api.get("/vasi/" + id) : Promise.resolve(null),
      ]);

      if (piante.length === 0) {
        app.toast("Crea prima almeno una pianta in catalogo", "errore");
        return;
      }

      // Inizializza gli stati del form
      selFertilizzanti = new Set(vaso?.fertilizzanti?.map((f) => f.id) || []);
      nuoveFitopatie = [];

      const v = vaso || {};
      // Applichiamo default sensati in creazione
      const formaCorr = v.forma || "cilindrico";

      const html = `
        <div class="modal-header">
          <h2 class="modal-titolo">${id ? "Modifica vaso" : "Nuovo vaso"}</h2>
          <button class="btn-chiudi" id="chiudi-modal-vaso">×</button>
        </div>

        <form id="form-vaso">

          <!-- === Pianta === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">🌿 Pianta</h3>
            <div class="form-grid">
              <div class="campo">
                <label for="fv-pianta">Tipo di pianta *</label>
                <select id="fv-pianta" name="pianta_id" required>
                  <option value="">— Seleziona —</option>
                  ${piante.map((p) => `
                    <option value="${p.id}" ${v.pianta_id === p.id ? "selected" : ""}>
                      ${app.escapeHtml(p.nome_comune)}
                    </option>`).join("")}
                </select>
              </div>
              <div class="campo">
                <label for="fv-esemplari">Esemplari</label>
                <input id="fv-esemplari" name="esemplari" type="number" min="1"
                       value="${v.esemplari || 1}" />
              </div>
              <div class="campo">
                <label for="fv-soprannome">Soprannome (opzionale)</label>
                <input id="fv-soprannome" name="soprannome"
                       placeholder="Es: Ficus del salotto"
                       value="${app.escapeHtml(v.soprannome)}" />
              </div>
              <div class="campo">
                <label for="fv-posizione">Posizione</label>
                <select id="fv-posizione" name="posizione">
                  ${opzioni(
                    ["interno","esterno","serra","balcone","terrazzo","giardino"],
                    v.posizione || "esterno"
                  )}
                </select>
              </div>
            </div>
          </div>

          <!-- === Vaso === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">📦 Vaso</h3>
            <div class="form-grid">
              <div class="campo">
                <label for="fv-forma">Forma</label>
                <select id="fv-forma" name="forma">
                  ${opzioni(
                    ["cilindrico","quadrato","rettangolare","conico","ovale"],
                    formaCorr
                  )}
                </select>
              </div>
              <div class="campo">
                <label for="fv-materiale">Materiale</label>
                <select id="fv-materiale" name="materiale">
                  ${opzioni(
                    ["plastica","terracotta","ceramica","legno","metallo","fibra","cemento","altro"],
                    v.materiale || "plastica"
                  )}
                </select>
              </div>
            </div>
            <!-- Campi dimensionali dinamici: li rigeneriamo quando cambia la forma. -->
            <div id="dimensioni-container" style="margin-top: 12px"></div>
            <div class="campo" style="margin-top: 8px">
              <label for="fv-volume">Volume (L)</label>
              <input id="fv-volume" name="volume_l" type="number" step="0.1" min="0"
                     placeholder="auto"
                     value="${valOrEmpty(v.volume_l)}" />
            </div>
          </div>

          <!-- === Substrato === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">🪨 Substrato</h3>
            <div class="campo">
              <label for="fv-substrato">Tipo di substrato</label>
              <select id="fv-substrato" name="substrato_id">
                <option value="">—</option>
                ${substrati.map((s) => `
                  <option value="${s.id}" ${v.substrato_id === s.id ? "selected" : ""}>
                    ${app.escapeHtml(s.nome)}
                  </option>`).join("")}
              </select>
            </div>
          </div>

          <!-- === Concimi utilizzati === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">💧 Concimi utilizzati</h3>
            <p class="muted" style="margin:0 0 8px;font-size:.85rem">
              Clicca un concime per (de)selezionarlo.
            </p>
            <input type="search" class="input-ricerca" id="ricerca-fert-form"
                   placeholder="Filtra concimi..." style="margin-bottom:8px" />
            <div class="chip-select" id="chip-select-fert">
              ${renderChipFertilizzanti(fertilizzanti)}
            </div>
          </div>

          <!-- === Fitopatie in corso === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">🔬 Fitopatie in corso</h3>
            ${renderFitopatieEsistenti(vaso?.fitopatie || [])}
            <div class="form-grid">
              <div class="campo">
                <label for="fv-fito-nuova">Aggiungi fitopatia</label>
                <select id="fv-fito-nuova">
                  <option value="">— Seleziona —</option>
                  ${fitopatie.map((f) => `
                    <option value="${f.id}">${app.escapeHtml(f.nome)} (${app.escapeHtml(f.tipo)})</option>
                  `).join("")}
                </select>
              </div>
              <div class="campo">
                <label for="fv-fito-gravita">Gravità (1-5)</label>
                <input id="fv-fito-gravita" type="number" min="1" max="5" value="2" />
              </div>
              <div class="campo full">
                <button type="button" class="btn-secondario" id="btn-aggiungi-fito">+ Aggiungi</button>
              </div>
              <div class="campo full" id="contenitore-fito-nuove"></div>
            </div>
          </div>

          <!-- === Date operative === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">📅 Date</h3>
            <div class="form-grid">
              <div class="campo">
                <label for="fv-invaso">Data invaso</label>
                <input id="fv-invaso" name="data_invaso" type="date"
                       value="${valOrEmpty(v.data_invaso)}" />
              </div>
              <div class="campo">
                <label for="fv-rinvaso">Ultimo rinvaso</label>
                <input id="fv-rinvaso" name="data_ultimo_rinvaso" type="date"
                       value="${valOrEmpty(v.data_ultimo_rinvaso)}" />
              </div>
              <div class="campo full">
                <label for="fv-annaffiatura">Ultima annaffiatura</label>
                <input id="fv-annaffiatura" name="data_ultima_annaffiatura" type="date"
                       value="${valOrEmpty(v.data_ultima_annaffiatura)}" />
              </div>
            </div>
          </div>

          <!-- === Note === -->
          <div class="form-gruppo">
            <h3 class="form-gruppo-titolo">📝 Note</h3>
            <div class="campo">
              <textarea name="note" placeholder="Osservazioni...">${app.escapeHtml(v.note)}</textarea>
            </div>
          </div>

          <div class="azioni-form">
            <button type="button" class="btn-secondario" id="btn-annulla-vaso">Annulla</button>
            <button type="submit" class="btn-primario">${id ? "Aggiorna" : "Crea vaso"}</button>
          </div>
        </form>
      `;

      app.modal.apri(html);
      wireFormEvents(v, fertilizzanti);
      // Generazione iniziale dei campi dimensionali in base alla forma
      rigeneraDimensioni(formaCorr, v);
    } catch (e) {
      app.toast("Errore caricamento dati: " + e.message, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Event wiring del form
  // ----------------------------------------------------------------
  function wireFormEvents(v, fertilizzanti) {
    // Chiusura
    document.getElementById("chiudi-modal-vaso").onclick = app.modal.chiudi;
    document.getElementById("btn-annulla-vaso").onclick = app.modal.chiudi;

    // Cambio forma -> rigenera campi dimensioni
    document.getElementById("fv-forma").addEventListener("change", (e) => {
      rigeneraDimensioni(e.target.value, v);
    });

    // Filtro dei chip dei fertilizzanti
    document.getElementById("ricerca-fert-form").addEventListener("input", (e) => {
      const q = app.normalizza(e.target.value);
      const filtrati = q
        ? fertilizzanti.filter((f) =>
            app.normalizza(f.nome).includes(q) ||
            app.normalizza(f.marca).includes(q))
        : fertilizzanti;
      document.getElementById("chip-select-fert").innerHTML = renderChipFertilizzanti(filtrati);
      wireChipFertilizzanti();
    });
    wireChipFertilizzanti();

    // Bottone "aggiungi fitopatia nuova"
    document.getElementById("btn-aggiungi-fito").addEventListener("click", () => {
      const sel = document.getElementById("fv-fito-nuova");
      const grav = document.getElementById("fv-fito-gravita");
      const id = Number(sel.value);
      if (!id) { app.toast("Seleziona una fitopatia", "errore"); return; }
      // Evita duplicati già aggiunti in questa sessione
      if (nuoveFitopatie.some((n) => n.fitopatia_id === id)) {
        app.toast("Fitopatia già in elenco", "errore"); return;
      }
      const nome = sel.options[sel.selectedIndex].textContent;
      nuoveFitopatie.push({
        fitopatia_id: id,
        nome,
        gravita: Number(grav.value) || 2,
        data_inizio: new Date().toISOString().slice(0, 10),
      });
      renderFitopatieNuove();
      sel.value = "";
    });

    // Submit
    document.getElementById("form-vaso").addEventListener("submit", (e) => {
      e.preventDefault();
      salva(e.target, v.id);
    });
  }

  function renderChipFertilizzanti(lista) {
    if (lista.length === 0) {
      return `<div class="muted" style="padding:8px">Nessun fertilizzante trovato</div>`;
    }
    return lista.map((f) => `
      <div class="chip-select-item ${selFertilizzanti.has(f.id) ? "selezionato" : ""}"
           data-id="${f.id}"
           title="${app.escapeHtml(f.marca || "")} NPK ${app.formatNPK(f.npk_n, f.npk_p, f.npk_k)}">
        ${app.escapeHtml(f.nome)}
        <span class="muted" style="font-size:.7rem;margin-left:4px">${app.escapeHtml(f.marca || "")}</span>
      </div>
    `).join("");
  }

  function wireChipFertilizzanti() {
    document.querySelectorAll("#chip-select-fert .chip-select-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.dataset.id);
        if (selFertilizzanti.has(id)) {
          selFertilizzanti.delete(id);
          el.classList.remove("selezionato");
        } else {
          selFertilizzanti.add(id);
          el.classList.add("selezionato");
        }
      });
    });
  }

  function renderFitopatieEsistenti(lista) {
    if (!lista || lista.length === 0) {
      return `<p class="muted" style="margin:0 0 8px;font-size:.85rem">
                Nessuna fitopatia registrata.
              </p>`;
    }
    return `
      <div style="margin-bottom:12px">
        ${lista.map((ep) => `
          <div style="padding:8px;background:#fff;border:1px solid var(--col-bordo);
                      border-radius:8px;margin-bottom:4px;font-size:.85rem">
            <strong>${app.escapeHtml(ep.fitopatia_nome)}</strong>
            <span class="chip warn" style="margin-left:6px">Gravità ${ep.gravita || "?"}</span>
            <span class="chip" style="margin-left:4px">dal ${ep.data_inizio || "?"}</span>
            ${ep.data_fine
              ? `<span class="chip" style="margin-left:4px">chiusa ${ep.data_fine}</span>`
              : `<span class="chip danger" style="margin-left:4px">in corso</span>`}
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderFitopatieNuove() {
    const container = document.getElementById("contenitore-fito-nuove");
    if (!container) return;
    if (nuoveFitopatie.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <div style="padding:8px;background:var(--col-sfondo);
                  border:1px dashed var(--col-verde-chiaro);border-radius:8px">
        <div class="muted" style="font-size:.8rem;margin-bottom:4px">Da aggiungere al salvataggio:</div>
        ${nuoveFitopatie.map((n, i) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:.85rem">
            <span>${app.escapeHtml(n.nome)}
              <span class="chip warn">G${n.gravita}</span></span>
            <button type="button" class="btn-icona" data-rimuovi="${i}">✕</button>
          </div>
        `).join("")}
      </div>
    `;
    container.querySelectorAll("[data-rimuovi]").forEach((btn) => {
      btn.addEventListener("click", () => {
        nuoveFitopatie.splice(Number(btn.dataset.rimuovi), 1);
        renderFitopatieNuove();
      });
    });
  }

  // ----------------------------------------------------------------
  // Gestione campi dimensionali dinamici
  // ----------------------------------------------------------------
  // Per ciascuna forma mostriamo un set di input diverso. Quando
  // cambiano i valori, ricalcoliamo il volume atteso e lo suggeriamo
  // all'utente (a meno che l'utente non l'abbia già modificato manualmente).
  // ----------------------------------------------------------------
  function rigeneraDimensioni(forma, v) {
    const container = document.getElementById("dimensioni-container");
    let html = "";
    switch (forma) {
      case "quadrato":
        html = `
          <div class="form-grid">
            <div class="campo">
              <label for="fv-lun">Lato (cm)</label>
              <input id="fv-lun" name="lunghezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.lunghezza_cm)}" />
            </div>
            <div class="campo">
              <label for="fv-alt">Altezza (cm)</label>
              <input id="fv-alt" name="altezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.altezza_cm)}" />
            </div>
          </div>`;
        break;
      case "rettangolare":
        html = `
          <div class="form-grid">
            <div class="campo">
              <label for="fv-lun">Lunghezza (cm)</label>
              <input id="fv-lun" name="lunghezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.lunghezza_cm)}" />
            </div>
            <div class="campo">
              <label for="fv-lar">Larghezza (cm)</label>
              <input id="fv-lar" name="larghezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.larghezza_cm)}" />
            </div>
            <div class="campo full">
              <label for="fv-alt">Altezza (cm)</label>
              <input id="fv-alt" name="altezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.altezza_cm)}" />
            </div>
          </div>`;
        break;
      case "conico":
        html = `
          <div class="form-grid">
            <div class="campo">
              <label for="fv-dsup">Ø sup. (cm)</label>
              <input id="fv-dsup" name="diametro_sup_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.diametro_sup_cm)}" />
            </div>
            <div class="campo">
              <label for="fv-dinf">Ø inf. (cm)</label>
              <input id="fv-dinf" name="diametro_inf_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.diametro_inf_cm)}" />
            </div>
            <div class="campo full">
              <label for="fv-alt">Altezza (cm)</label>
              <input id="fv-alt" name="altezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.altezza_cm)}" />
            </div>
          </div>`;
        break;
      case "ovale":
        // Approssimiamo l'ovale con due semi-assi (diametro_sup e larghezza come asse minore)
        html = `
          <div class="form-grid">
            <div class="campo">
              <label for="fv-dsup">Asse maggiore (cm)</label>
              <input id="fv-dsup" name="diametro_sup_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.diametro_sup_cm)}" />
            </div>
            <div class="campo">
              <label for="fv-lar">Asse minore (cm)</label>
              <input id="fv-lar" name="larghezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.larghezza_cm)}" />
            </div>
            <div class="campo full">
              <label for="fv-alt">Altezza (cm)</label>
              <input id="fv-alt" name="altezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.altezza_cm)}" />
            </div>
          </div>`;
        break;
      case "cilindrico":
      default:
        html = `
          <div class="form-grid">
            <div class="campo">
              <label for="fv-dsup">Ø sup. (cm)</label>
              <input id="fv-dsup" name="diametro_sup_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.diametro_sup_cm)}" />
            </div>
            <div class="campo">
              <label for="fv-alt">Altezza (cm)</label>
              <input id="fv-alt" name="altezza_cm" type="number" step="0.5"
                     value="${valOrEmpty(v.altezza_cm)}" />
            </div>
          </div>`;
    }
    container.innerHTML = html;

    // Attacchiamo listener per ricalcolo volume in tempo reale.
    // Il flag `volume_utente_modificato` evita di sovrascrivere un valore
    // che l'utente ha impostato manualmente.
    const volumeInput = document.getElementById("fv-volume");
    let utenteHaModificato = !!v.volume_l;
    volumeInput.addEventListener("input", () => { utenteHaModificato = true; });

    container.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        if (utenteHaModificato) return;
        const formaAttuale = document.getElementById("fv-forma").value;
        const vol = calcolaVolume(formaAttuale);
        if (vol != null) volumeInput.value = vol.toFixed(2);
      });
    });
  }

  /**
   * Calcola il volume in litri dati i valori correnti del form.
   * Restituisce null se mancano dati essenziali.
   *
   * Un litro = 1000 cm³. Quindi V_cm3 / 1000 = litri.
   */
  function calcolaVolume(forma) {
    const n = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const v = parseFloat(el.value);
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    switch (forma) {
      case "quadrato": {
        const l = n("fv-lun"), h = n("fv-alt");
        return (l && h) ? (l * l * h) / 1000 : null;
      }
      case "rettangolare": {
        const l = n("fv-lun"), w = n("fv-lar"), h = n("fv-alt");
        return (l && w && h) ? (l * w * h) / 1000 : null;
      }
      case "conico": {
        // Tronco di cono: V = (π·h/3) · (R² + R·r + r²)
        const D = n("fv-dsup"), d = n("fv-dinf"), h = n("fv-alt");
        if (!D || !d || !h) return null;
        const R = D / 2, r = d / 2;
        return (Math.PI * h / 3) * (R * R + R * r + r * r) / 1000;
      }
      case "ovale": {
        // Ellisse: V = π · a · b · h (a e b semi-assi)
        const A = n("fv-dsup"), B = n("fv-lar"), h = n("fv-alt");
        if (!A || !B || !h) return null;
        return (Math.PI * (A / 2) * (B / 2) * h) / 1000;
      }
      case "cilindrico":
      default: {
        // V = π · r² · h
        const D = n("fv-dsup"), h = n("fv-alt");
        if (!D || !h) return null;
        const r = D / 2;
        return (Math.PI * r * r * h) / 1000;
      }
    }
  }

  // ----------------------------------------------------------------
  // Salvataggio
  // ----------------------------------------------------------------
  async function salva(form, id) {
    const fd = new FormData(form);
    const data = {
      pianta_id:        numOrNull(fd.get("pianta_id")),
      soprannome:       fd.get("soprannome")?.trim() || null,
      posizione:        fd.get("posizione") || "esterno",
      esemplari:        numOrNull(fd.get("esemplari")) || 1,
      forma:            fd.get("forma") || "cilindrico",
      materiale:        fd.get("materiale") || "plastica",
      diametro_sup_cm:  numOrNull(fd.get("diametro_sup_cm")),
      diametro_inf_cm:  numOrNull(fd.get("diametro_inf_cm")),
      lunghezza_cm:     numOrNull(fd.get("lunghezza_cm")),
      larghezza_cm:     numOrNull(fd.get("larghezza_cm")),
      altezza_cm:       numOrNull(fd.get("altezza_cm")),
      volume_l:         numOrNull(fd.get("volume_l")),
      substrato_id:     numOrNull(fd.get("substrato_id")),
      data_invaso:              fd.get("data_invaso") || null,
      data_ultimo_rinvaso:      fd.get("data_ultimo_rinvaso") || null,
      data_ultima_annaffiatura: fd.get("data_ultima_annaffiatura") || null,
      note:                     fd.get("note")?.trim() || null,
      fertilizzanti:   [...selFertilizzanti],
      fitopatie_nuove: nuoveFitopatie,
    };

    if (!data.pianta_id) {
      app.toast("Seleziona una pianta", "errore");
      return;
    }

    try {
      if (id) {
        await app.api.put("/vasi/" + id, data);
        app.toast("Vaso aggiornato");
      } else {
        await app.api.post("/vasi", data);
        app.toast("Vaso creato");
      }
      app.modal.chiudi();
      await render();
    } catch (e) {
      app.toast("Errore nel salvataggio: " + e.message, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Eliminazione
  // ----------------------------------------------------------------
  async function elimina(id) {
    const v = vasi.find((x) => x.id === id);
    if (!v) return;
    const nome = v.soprannome || v.pianta_nome;
    if (!app.conferma(`Eliminare il vaso "${nome}"?`)) return;
    try {
      await app.api.del("/vasi/" + id);
      app.toast("Vaso eliminato");
      await render();
    } catch (e) {
      app.toast("Errore: " + e.message, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  function opzioni(lista, attuale) {
    return lista.map((v) =>
      `<option value="${app.escapeHtml(v)}" ${v === attuale ? "selected" : ""}>${app.escapeHtml(v)}</option>`
    ).join("");
  }
  function valOrEmpty(v) { return v == null || v === "" ? "" : v; }
  function numOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ----------------------------------------------------------------
  // Wiring
  // ----------------------------------------------------------------
  document.getElementById("btn-aggiungi-vaso").addEventListener("click", () => apriForm(null));
  inputRicerca.addEventListener("input", (e) => {
    filtro = e.target.value;
    disegnaLista();
  });

  window.app.moduli.vasi = { render };
})();
