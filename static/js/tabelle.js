/* ============================================================
   tabelle.js - Modulo "Gestione Tabelle"
   ============================================================
   Gestisce quattro anagrafiche di supporto:

     - Fertilizzanti         (marca, NPK, tipo, forma, dosaggio)
     - Substrati             (con composizione = array di componenti)
     - Componenti substrato  (anagrafica degli ingredienti)
     - Fitopatie             (sintomi, prevenzione, trattamento)

   Stato locale: una mappa `stato[nome]` con una sotto-sezione per
   ciascuna tabella (items cached + filtro di ricerca + riferimenti DOM).

   Entry point esposti via window.app.moduli.tabelle:
     - render():            ridisegna la tabella attualmente attiva
     - renderTabella(nome): ridisegna la tabella specificata
   ============================================================ */

(function () {
  "use strict";

  // ----------------------------------------------------------------
  // Stato locale
  // ----------------------------------------------------------------
  const stato = {
    fertilizzanti: { items: [], filtro: "", lista: null, ricerca: null },
    substrati:     { items: [], filtro: "", lista: null, ricerca: null },
    componenti:    { items: [], filtro: "", lista: null, ricerca: null },
    fitopatie:     { items: [], filtro: "", lista: null, ricerca: null },
  };

  // Bind dei riferimenti DOM una volta sola
  stato.fertilizzanti.lista   = document.getElementById("lista-fertilizzanti");
  stato.fertilizzanti.ricerca = document.getElementById("ricerca-fertilizzanti");
  stato.substrati.lista       = document.getElementById("lista-substrati");
  stato.substrati.ricerca     = document.getElementById("ricerca-substrati");
  stato.componenti.lista      = document.getElementById("lista-componenti");
  stato.componenti.ricerca    = document.getElementById("ricerca-componenti");
  stato.fitopatie.lista       = document.getElementById("lista-fitopatie");
  stato.fitopatie.ricerca     = document.getElementById("ricerca-fitopatie");

  // ----------------------------------------------------------------
  // Dispatcher principale
  // ----------------------------------------------------------------
  function tabellaAttiva() {
    const pannello = document.querySelector(".pannello-tabella.attivo");
    if (!pannello) return "fertilizzanti";
    return pannello.id.replace("pannello-", "");
  }

  async function render() {
    await renderTabella(tabellaAttiva());
  }

  async function renderTabella(nome) {
    if (!stato[nome]) return;
    try {
      stato[nome].items = await app.cache.carica(nome, true);
      disegnaLista(nome);
    } catch (e) {
      app.toast(`Errore nel caricamento ${nome}: ${e.message}`, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Rendering delle liste
  // ----------------------------------------------------------------
  function disegnaLista(nome) {
    const s = stato[nome];
    const q = app.normalizza(s.filtro);

    const visibili = s.items.filter((it) => {
      if (!q) return true;
      return matchFiltro(nome, it, q);
    });

    if (visibili.length === 0) {
      s.lista.innerHTML = `<div class="lista-vuota">
        ${s.items.length === 0
          ? `Nessun record in <strong>${etichetta(nome)}</strong>. Clicca <strong>+ Aggiungi</strong> per iniziare.`
          : "Nessun risultato per la ricerca corrente."}
      </div>`;
      return;
    }

    s.lista.innerHTML = visibili.map((it) => cardHtml(nome, it)).join("");

    s.lista.onclick = (ev) => {
      const btn = ev.target.closest("[data-azione]");
      if (!btn) return;
      const id = Number(btn.closest(".card").dataset.id);
      const azione = btn.dataset.azione;
      if (azione === "modifica") apriForm(nome, id);
      else if (azione === "elimina") elimina(nome, id);
    };
  }

  function matchFiltro(nome, it, q) {
    let blob = "";
    if (nome === "fertilizzanti") {
      blob = `${it.nome || ""} ${it.marca || ""} ${it.tipo || ""} ${it.forma || ""}`;
    } else if (nome === "substrati") {
      blob = `${it.nome || ""} ${it.descrizione || ""}`;
      if (Array.isArray(it.composizione)) {
        blob += " " + it.composizione.map((c) => c.nome || c.componente || "").join(" ");
      }
    } else if (nome === "componenti") {
      blob = `${it.nome || ""} ${it.categoria || ""} ${it.descrizione || ""}`;
    } else if (nome === "fitopatie") {
      blob = `${it.nome || ""} ${it.tipo || ""} ${it.sintomi || ""}`;
    }
    return app.normalizza(blob).includes(q);
  }

  function etichetta(nome) {
    return {
      fertilizzanti: "Fertilizzanti",
      substrati:     "Substrati",
      componenti:    "Componenti substrato",
      fitopatie:     "Fitopatie",
    }[nome];
  }

  function etichettaSingolare(nome) {
    return {
      fertilizzanti: "fertilizzante",
      substrati:     "substrato",
      componenti:    "componente",
      fitopatie:     "fitopatia",
    }[nome];
  }

  // ----------------------------------------------------------------
  // Card per ciascun tipo
  // ----------------------------------------------------------------
  function cardHtml(nome, it) {
    if (nome === "fertilizzanti") return cardFertilizzante(it);
    if (nome === "substrati")     return cardSubstrato(it);
    if (nome === "componenti")    return cardComponente(it);
    if (nome === "fitopatie")     return cardFitopatia(it);
    return "";
  }

  function cardFertilizzante(f) {
    const npk = app.formatNPK(f.npk_n, f.npk_p, f.npk_k);
    return `
      <div class="card" data-id="${f.id}">
        <div class="card-header">
          <div>
            <h3 class="card-titolo">${app.escapeHtml(f.nome)}</h3>
            ${f.marca ? `<div class="card-sottotitolo">${app.escapeHtml(f.marca)}</div>` : ""}
          </div>
          <div class="card-azioni">
            <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
          </div>
        </div>
        <div class="card-meta">
          ${npk ? `<span class="chip info">NPK ${app.escapeHtml(npk)}</span>` : ""}
          ${f.tipo  ? `<span class="chip alt">${app.escapeHtml(f.tipo)}</span>`  : ""}
          ${f.forma ? `<span class="chip">${app.escapeHtml(f.forma)}</span>`     : ""}
          ${f.dosaggio_ml_per_l != null
            ? `<span class="chip">${f.dosaggio_ml_per_l} ml/L</span>` : ""}
          ${f.preimpostato ? `<span class="chip warn" title="Record preimpostato">★ preset</span>` : ""}
        </div>
        ${f.note ? `<div class="muted" style="margin-top:8px;font-size:.85rem">${app.escapeHtml(f.note)}</div>` : ""}
      </div>`;
  }

  function cardSubstrato(s) {
    const comp = Array.isArray(s.composizione) ? s.composizione : [];
    // Nel rendering uso `nome` se presente (nuovo formato) o `componente`
    // (vecchio formato seedato). Il pallino colorato cerca il componente
    // corrispondente nella cache per prendere il colore.
    const chipsComp = comp.slice(0, 4).map((c) => {
      const nomeC = c.nome || c.componente || "?";
      const colore = coloreDaNome(nomeC);
      return `<span class="chip chip-con-pallino">
        <span class="chip-pallino" style="background:${colore}"></span>
        ${app.escapeHtml(nomeC)}${c.percentuale != null ? ` ${c.percentuale}%` : ""}
      </span>`;
    }).join("");
    const altri = comp.length > 4 ? `<span class="chip">+${comp.length - 4}</span>` : "";

    return `
      <div class="card" data-id="${s.id}">
        <div class="card-header">
          <div>
            <h3 class="card-titolo">${app.escapeHtml(s.nome)}</h3>
            ${s.descrizione ? `<div class="card-sottotitolo">${app.escapeHtml(s.descrizione)}</div>` : ""}
          </div>
          <div class="card-azioni">
            <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
          </div>
        </div>
        <div class="card-meta">
          ${chipsComp}${altri}
          ${s.whc != null ? `<span class="chip info">WHC ${s.whc}%</span>` : ""}
          ${(s.ph_min != null && s.ph_max != null)
            ? `<span class="chip">pH ${s.ph_min}–${s.ph_max}</span>` : ""}
          ${s.drenaggio ? `<span class="chip alt">drenaggio ${app.escapeHtml(s.drenaggio)}</span>` : ""}
          ${s.preimpostato ? `<span class="chip warn" title="Substrato preimpostato">★ preset</span>` : ""}
        </div>
        ${s.note ? `<div class="muted" style="margin-top:8px;font-size:.85rem">${app.escapeHtml(s.note)}</div>` : ""}
      </div>`;
  }

  function cardComponente(c) {
    const colore = c.colore || "#c0c0c0";
    // Classe CSS diversa per categoria — mappatura usata anche nel form
    const chipCat = {
      minerale: "info", organico: "alt", misto: "", biostimolante: "warn"
    }[c.categoria] || "";

    return `
      <div class="card" data-id="${c.id}">
        <div class="card-header">
          <div class="componente-titolo-wrap">
            <span class="componente-pallino-grande" style="background:${app.escapeHtml(colore)}"></span>
            <div>
              <h3 class="card-titolo">${app.escapeHtml(c.nome)}</h3>
              ${c.categoria ? `<div class="card-sottotitolo">${app.escapeHtml(c.categoria)}</div>` : ""}
            </div>
          </div>
          <div class="card-azioni">
            <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
          </div>
        </div>
        <div class="card-meta">
          ${c.categoria ? `<span class="chip ${chipCat}">${app.escapeHtml(c.categoria)}</span>` : ""}
          <span class="chip" title="Colore associato">${app.escapeHtml(colore)}</span>
          ${c.preimpostato ? `<span class="chip warn" title="Componente preimpostato">★ preset</span>` : ""}
        </div>
        ${c.descrizione ? `<div class="muted" style="margin-top:8px;font-size:.85rem">${app.escapeHtml(c.descrizione)}</div>` : ""}
      </div>`;
  }

  function cardFitopatia(f) {
    return `
      <div class="card" data-id="${f.id}">
        <div class="card-header">
          <div>
            <h3 class="card-titolo">${app.escapeHtml(f.nome)}</h3>
            ${f.tipo ? `<div class="card-sottotitolo">${app.escapeHtml(f.tipo)}</div>` : ""}
          </div>
          <div class="card-azioni">
            <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
          </div>
        </div>
        ${f.sintomi ? `<div class="muted" style="margin-top:8px;font-size:.85rem">
          <strong>Sintomi:</strong> ${app.escapeHtml(f.sintomi)}
        </div>` : ""}
        <div class="card-meta">
          ${f.preimpostato ? `<span class="chip warn" title="Fitopatia preimpostata">★ preset</span>` : ""}
        </div>
      </div>`;
  }

  // Helper: dato un nome testuale di componente (proveniente magari da
  // un JSON legacy), cerca il componente nella cache per estrarre il
  // colore. Se non trovato usa un grigio neutro.
  function coloreDaNome(nomeC) {
    const cache = app.cache.componenti;
    if (!cache || !Array.isArray(cache)) return "#c0c0c0";
    const norm = app.normalizza(nomeC);
    const trovato = cache.find((c) => app.normalizza(c.nome) === norm);
    return trovato?.colore || "#c0c0c0";
  }

  // ----------------------------------------------------------------
  // Form: apertura e dispatch
  // ----------------------------------------------------------------
  async function apriForm(nome, id = null) {
    // Per il form substrato ho bisogno della lista componenti in cache
    // (per popolare la dropdown). La carico se non c'è ancora.
    if (nome === "substrati" && !app.cache.componenti) {
      try { await app.cache.carica("componenti"); }
      catch (_) { /* se fallisce procediamo comunque con cache vuota */ }
    }

    const item = id != null ? stato[nome].items.find((x) => x.id === id) : null;
    const isEdit = !!item;
    const titolo = `${isEdit ? "Modifica" : "Nuovo"} ${etichettaSingolare(nome)}`;

    let corpoForm = "";
    if (nome === "fertilizzanti")    corpoForm = formFertilizzante(item);
    else if (nome === "substrati")   corpoForm = formSubstrato(item);
    else if (nome === "componenti")  corpoForm = formComponente(item);
    else if (nome === "fitopatie")   corpoForm = formFitopatia(item);

    const html = `
      <div class="modal-corpo">
        <div class="modal-header">
          <h2>${titolo}</h2>
          <button class="btn-icona" data-chiudi title="Chiudi">✕</button>
        </div>
        <form id="form-tabella" class="form" novalidate>
          ${corpoForm}
          <div class="form-azioni">
            <button type="button" class="btn-secondario" data-chiudi>Annulla</button>
            <button type="submit" class="btn-primario">${isEdit ? "Salva modifiche" : "Crea"}</button>
          </div>
        </form>
      </div>`;

    app.modal.apri(html);

    document.querySelectorAll("[data-chiudi]").forEach((b) =>
      b.addEventListener("click", () => app.modal.chiudi())
    );

    // Wiring specifici del tipo di form
    if (nome === "substrati")  wiringComposizione(item);
    if (nome === "componenti") wiringColorPicker(item);

    document.getElementById("form-tabella").addEventListener("submit", (ev) => {
      ev.preventDefault();
      salva(nome, item);
    });
  }

  // ----------------------------------------------------------------
  // Form: fertilizzante (invariato rispetto alla v precedente)
  // ----------------------------------------------------------------
  function formFertilizzante(f) {
    const v = f || {};
    const preset = !!v.preimpostato;
    return `
      ${preset ? `<div class="avviso warn">
        Questo fertilizzante è marcato come <strong>preset</strong>. Puoi modificarlo liberamente,
        ma considera che è un valore di riferimento.
      </div>` : ""}

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Identificazione</div>
        <div class="form-grid">
          <label>
            <span>Nome *</span>
            <input name="nome" type="text" required value="${app.escapeHtml(v.nome || "")}" />
          </label>
          <label>
            <span>Marca</span>
            <input name="marca" type="text" value="${app.escapeHtml(v.marca || "")}" />
          </label>
        </div>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Titolazione NPK</div>
        <div class="form-grid tre-colonne">
          <label>
            <span>N (%)</span>
            <input name="npk_n" type="number" step="0.1" min="0" max="100" value="${v.npk_n ?? ""}" />
          </label>
          <label>
            <span>P (%)</span>
            <input name="npk_p" type="number" step="0.1" min="0" max="100" value="${v.npk_p ?? ""}" />
          </label>
          <label>
            <span>K (%)</span>
            <input name="npk_k" type="number" step="0.1" min="0" max="100" value="${v.npk_k ?? ""}" />
          </label>
        </div>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Caratteristiche</div>
        <div class="form-grid">
          <label>
            <span>Tipo</span>
            <select name="tipo">
              <option value="">— seleziona —</option>
              ${["organico","minerale","organo-minerale","biostimolante","correttivo"]
                .map((t) => `<option value="${t}" ${v.tipo === t ? "selected" : ""}>${t}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            <span>Forma</span>
            <select name="forma">
              <option value="">— seleziona —</option>
              ${["liquido","granulare","polvere","stick","pellet","hydro"]
                .map((f2) => `<option value="${f2}" ${v.forma === f2 ? "selected" : ""}>${f2}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            <span>Dosaggio (ml/L)</span>
            <input name="dosaggio_ml_per_l" type="number" step="0.1" min="0"
                   value="${v.dosaggio_ml_per_l ?? ""}" />
          </label>
        </div>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Note</div>
        <label>
          <textarea name="note" rows="3" placeholder="Indicazioni d'uso, periodi consigliati, ecc.">${app.escapeHtml(v.note || "")}</textarea>
        </label>
      </div>
    `;
  }

  // ----------------------------------------------------------------
  // Form: SUBSTRATO (editor di composizione con dropdown + pallino)
  // ----------------------------------------------------------------
  function formSubstrato(s) {
    const v = s || {};
    const preset = !!v.preimpostato;
    const comp = Array.isArray(v.composizione) ? v.composizione : [];

    // Risolvo per ogni riga il componente_id. Se la riga ha già
    // `componente_id` uso quello (nuovo formato); altrimenti cerco per
    // nome nella cache (retrocompat con i substrati seedati nel formato
    // vecchio `{componente: "perlite", percentuale: 30}`).
    const righeIn = comp.length > 0 ? comp : [{ componente_id: null, nome: "", percentuale: "" }];
    const righe = righeIn.map((c) => {
      let compId = c.componente_id != null ? Number(c.componente_id) : null;
      const nomeStoricizzato = c.nome || c.componente || "";
      if (compId == null && nomeStoricizzato) {
        const trovato = (app.cache.componenti || []).find(
          (x) => app.normalizza(x.nome) === app.normalizza(nomeStoricizzato)
        );
        if (trovato) compId = trovato.id;
      }
      return {
        componente_id: compId,
        nome: nomeStoricizzato,
        percentuale: c.percentuale ?? "",
      };
    });

    const righeHtml = righe.map((c, i) => rigaComposizioneHtml(i, c)).join("");

    return `
      ${preset ? `<div class="avviso warn">
        Questo substrato è marcato come <strong>preset</strong>. Puoi modificarlo,
        ma tieni presente che è uno dei mix di riferimento seedati all'inizio.
      </div>` : ""}

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Identificazione</div>
        <div class="form-grid">
          <label>
            <span>Nome *</span>
            <input name="nome" type="text" required value="${app.escapeHtml(v.nome || "")}" />
          </label>
          <label>
            <span>Drenaggio</span>
            <select name="drenaggio">
              <option value="">— seleziona —</option>
              ${["scarso","medio","buono","ottimo"]
                .map((d) => `<option value="${d}" ${v.drenaggio === d ? "selected" : ""}>${d}</option>`)
                .join("")}
            </select>
          </label>
        </div>
        <label>
          <span>Descrizione</span>
          <input name="descrizione" type="text"
                 placeholder="Breve descrizione dell'impiego"
                 value="${app.escapeHtml(v.descrizione || "")}" />
        </label>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Composizione</div>
        <p class="muted" style="font-size:.85rem; margin:0 0 8px 0;">
          Scegli un componente dall'anagrafica e inserisci la percentuale. Gli
          ingredienti mancanti puoi crearli nella tab <strong>Componenti</strong>.
        </p>
        <div id="composizione-righe" data-prossimo="${righe.length}">
          ${righeHtml}
        </div>
        <button type="button" class="btn-secondario" id="btn-aggiungi-componente-riga">
          + Aggiungi componente
        </button>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Parametri fisico-chimici</div>
        <div class="form-grid tre-colonne">
          <label>
            <span>WHC (%)</span>
            <input name="whc" type="number" step="0.1" min="0" max="100"
                   title="Water Holding Capacity"
                   value="${v.whc ?? ""}" />
          </label>
          <label>
            <span>pH min</span>
            <input name="ph_min" type="number" step="0.1" min="0" max="14" value="${v.ph_min ?? ""}" />
          </label>
          <label>
            <span>pH max</span>
            <input name="ph_max" type="number" step="0.1" min="0" max="14" value="${v.ph_max ?? ""}" />
          </label>
        </div>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Note</div>
        <label>
          <textarea name="note" rows="3" placeholder="Indicazioni, piante adatte, avvertenze">${app.escapeHtml(v.note || "")}</textarea>
        </label>
      </div>
    `;
  }

  // Riga singola dell'editor composizione: pallino colorato + dropdown
  // componenti + input percentuale + bottone elimina. La dropdown è
  // popolata dalla cache `app.cache.componenti` ordinata per nome.
  function rigaComposizioneHtml(i, c) {
    const cache = app.cache.componenti || [];
    const ordinati = [...cache].sort(
      (a, b) => app.normalizza(a.nome).localeCompare(app.normalizza(b.nome))
    );
    // Opzioni della dropdown: primo placeholder vuoto, poi ciascun
    // componente con data-colore così JS può aggiornare il pallino.
    const opts = [
      `<option value="" data-colore="#c0c0c0">— seleziona componente —</option>`,
      ...ordinati.map((comp) =>
        `<option value="${comp.id}" data-colore="${app.escapeHtml(comp.colore || "#c0c0c0")}"
          ${Number(c.componente_id) === comp.id ? "selected" : ""}>${app.escapeHtml(comp.nome)}</option>`
      ),
    ].join("");

    // Colore iniziale del pallino: quello del componente selezionato,
    // o grigio di default se nessuno.
    const coloreIniziale = c.componente_id
      ? (ordinati.find((x) => x.id === Number(c.componente_id))?.colore || "#c0c0c0")
      : "#c0c0c0";

    return `
      <div class="composizione-riga" data-riga="${i}">
        <span class="composizione-pallino" style="background:${coloreIniziale}"></span>
        <select class="comp-select">${opts}</select>
        <input type="number" class="comp-perc" placeholder="%"
               step="1" min="0" max="100"
               value="${c.percentuale ?? ""}" />
        <button type="button" class="btn-icona btn-rimuovi-componente" title="Rimuovi">🗑️</button>
      </div>`;
  }

  // Wiring dell'editor composizione: aggiunta riga, rimozione riga,
  // aggiornamento del pallino quando cambia la selezione della dropdown.
  function wiringComposizione(_item) {
    const cont = document.getElementById("composizione-righe");
    const btnAdd = document.getElementById("btn-aggiungi-componente-riga");
    if (!cont || !btnAdd) return;

    // Aggiornamento del pallino colorato: delegato sul contenitore
    // così funziona sia per righe iniziali che per quelle aggiunte
    // dopo via JS.
    cont.addEventListener("change", (ev) => {
      const sel = ev.target.closest(".comp-select");
      if (!sel) return;
      const opt = sel.options[sel.selectedIndex];
      const colore = opt?.dataset?.colore || "#c0c0c0";
      const pallino = sel.closest(".composizione-riga")
                         .querySelector(".composizione-pallino");
      if (pallino) pallino.style.background = colore;
    });

    btnAdd.addEventListener("click", () => {
      const prossimo = Number(cont.dataset.prossimo || "0");
      cont.insertAdjacentHTML("beforeend",
        rigaComposizioneHtml(prossimo, { componente_id: null, percentuale: "" }));
      cont.dataset.prossimo = String(prossimo + 1);
    });

    cont.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-rimuovi-componente");
      if (!btn) return;
      const riga = btn.closest(".composizione-riga");
      if (cont.querySelectorAll(".composizione-riga").length === 1) {
        // Ultima riga rimasta: resetto invece di togliere
        riga.querySelector(".comp-select").value = "";
        riga.querySelector(".comp-perc").value = "";
        riga.querySelector(".composizione-pallino").style.background = "#c0c0c0";
      } else {
        riga.remove();
      }
    });
  }

  // Raccoglie la composizione dal DOM. Ogni riga produce:
  //   { componente_id, nome, percentuale }
  // Il nome viene preso dal testo dell'option selezionata così resta
  // denormalizzato (serve per la retrocompat se un componente viene
  // cancellato). Righe senza componente selezionato vengono scartate.
  function raccogliComposizione() {
    const righe = document.querySelectorAll("#composizione-righe .composizione-riga");
    const out = [];
    righe.forEach((r) => {
      const sel = r.querySelector(".comp-select");
      const percStr = r.querySelector(".comp-perc").value.trim();
      const idStr = sel.value;
      if (!idStr) return; // riga senza componente = scartata

      const componenteId = Number(idStr);
      const opt = sel.options[sel.selectedIndex];
      const nome = opt ? opt.textContent.trim() : "";
      const perc = percStr === "" ? null : Number(percStr);

      out.push({
        componente_id: componenteId,
        nome,
        percentuale: Number.isFinite(perc) ? perc : null,
      });
    });
    return out;
  }

  // ----------------------------------------------------------------
  // Form: COMPONENTE (nuovo)
  // ----------------------------------------------------------------
  function formComponente(c) {
    const v = c || {};
    const preset = !!v.preimpostato;
    const colore = v.colore || "#8a9a5b";
    return `
      ${preset ? `<div class="avviso warn">
        Questo componente è marcato come <strong>preset</strong>. Se lo modifichi,
        il cambio si riflette nella dropdown di composizione dei substrati.
      </div>` : ""}

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Identificazione</div>
        <label>
          <span>Nome *</span>
          <input name="nome" type="text" required
                 placeholder="Es: Perlite, Torba, Humus di lombrico..."
                 value="${app.escapeHtml(v.nome || "")}" />
        </label>
        <div class="form-grid">
          <label>
            <span>Categoria</span>
            <select name="categoria">
              <option value="">— seleziona —</option>
              ${["minerale","organico","misto","biostimolante"]
                .map((cat) => `<option value="${cat}" ${v.categoria === cat ? "selected" : ""}>${cat}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            <span>Colore</span>
            <div class="color-picker-wrap">
              <!-- Preview colore grande, clicca per aprire il picker nativo -->
              <span id="color-preview" class="componente-pallino-grande"
                    style="background:${app.escapeHtml(colore)}"></span>
              <input name="colore" id="color-input" type="color"
                     value="${app.escapeHtml(colore)}" />
              <input name="colore_testo" id="color-testo" type="text"
                     value="${app.escapeHtml(colore)}"
                     placeholder="#rrggbb" maxlength="7" />
            </div>
          </label>
        </div>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Descrizione</div>
        <label>
          <textarea name="descrizione" rows="3"
                    placeholder="Breve nota d'uso, caratteristiche, quando usarlo...">${app.escapeHtml(v.descrizione || "")}</textarea>
        </label>
      </div>
    `;
  }

  // Wiring del form componente: sincronizza i tre campi colore
  // (preview grande, input type=color nativo, testo esadecimale).
  function wiringColorPicker(_item) {
    const input = document.getElementById("color-input");
    const testo = document.getElementById("color-testo");
    const preview = document.getElementById("color-preview");
    if (!input || !testo || !preview) return;

    input.addEventListener("input", () => {
      preview.style.background = input.value;
      testo.value = input.value;
    });

    testo.addEventListener("input", () => {
      const v = testo.value.trim();
      // Valido il formato hex #rrggbb prima di applicare
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        preview.style.background = v;
        input.value = v;
      }
    });
  }

  // ----------------------------------------------------------------
  // Form: fitopatia (invariato)
  // ----------------------------------------------------------------
  function formFitopatia(f) {
    const v = f || {};
    const preset = !!v.preimpostato;
    return `
      ${preset ? `<div class="avviso warn">
        Questa fitopatia è marcata come <strong>preset</strong>. Puoi modificarla
        se vuoi personalizzare sintomi o trattamento.
      </div>` : ""}

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Identificazione</div>
        <div class="form-grid">
          <label>
            <span>Nome *</span>
            <input name="nome" type="text" required value="${app.escapeHtml(v.nome || "")}" />
          </label>
          <label>
            <span>Tipo</span>
            <select name="tipo">
              <option value="">— seleziona —</option>
              ${["fungina","batterica","virale","parassita","carenza","fisiopatia"]
                .map((t) => `<option value="${t}" ${v.tipo === t ? "selected" : ""}>${t}</option>`)
                .join("")}
            </select>
          </label>
        </div>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Descrizione</div>
        <label>
          <span>Sintomi</span>
          <textarea name="sintomi" rows="2" placeholder="Come si manifesta sulla pianta">${app.escapeHtml(v.sintomi || "")}</textarea>
        </label>
        <label>
          <span>Prevenzione</span>
          <textarea name="prevenzione" rows="2" placeholder="Pratiche colturali e ambientali per evitarla">${app.escapeHtml(v.prevenzione || "")}</textarea>
        </label>
        <label>
          <span>Trattamento</span>
          <textarea name="trattamento" rows="2" placeholder="Rimedi e prodotti consigliati">${app.escapeHtml(v.trattamento || "")}</textarea>
        </label>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Note</div>
        <label>
          <textarea name="note" rows="2" placeholder="Osservazioni personali, episodi passati">${app.escapeHtml(v.note || "")}</textarea>
        </label>
      </div>
    `;
  }

  // ----------------------------------------------------------------
  // Salvataggio
  // ----------------------------------------------------------------
  async function salva(nome, item) {
    const form = document.getElementById("form-tabella");
    const fd = new FormData(form);

    const payload = {
      nome: (fd.get("nome") || "").toString().trim(),
      note: valOrNull(fd.get("note")),
    };

    if (!payload.nome) {
      app.toast("Il nome è obbligatorio", "errore");
      return;
    }

    if (nome === "fertilizzanti") {
      payload.marca             = valOrNull(fd.get("marca"));
      payload.npk_n             = numOrNull(fd.get("npk_n"));
      payload.npk_p             = numOrNull(fd.get("npk_p"));
      payload.npk_k             = numOrNull(fd.get("npk_k"));
      payload.tipo              = valOrNull(fd.get("tipo"));
      payload.forma             = valOrNull(fd.get("forma"));
      payload.dosaggio_ml_per_l = numOrNull(fd.get("dosaggio_ml_per_l"));
    } else if (nome === "substrati") {
      payload.descrizione  = valOrNull(fd.get("descrizione"));
      payload.drenaggio    = valOrNull(fd.get("drenaggio"));
      payload.whc          = numOrNull(fd.get("whc"));
      payload.ph_min       = numOrNull(fd.get("ph_min"));
      payload.ph_max       = numOrNull(fd.get("ph_max"));
      payload.composizione = raccogliComposizione();

      if (payload.ph_min != null && payload.ph_max != null
          && payload.ph_min > payload.ph_max) {
        app.toast("pH min non può essere superiore a pH max", "errore");
        return;
      }
    } else if (nome === "componenti") {
      payload.categoria   = valOrNull(fd.get("categoria"));
      // Preferisco il valore del campo testuale se valido (l'utente
      // potrebbe averci scritto sopra dopo aver usato il picker),
      // altrimenti cado sull'input type=color.
      const cTesto = (fd.get("colore_testo") || "").toString().trim();
      const cPicker = (fd.get("colore") || "").toString().trim();
      payload.colore = /^#[0-9a-fA-F]{6}$/.test(cTesto) ? cTesto : (cPicker || null);
      payload.descrizione = valOrNull(fd.get("descrizione"));
      // I componenti non hanno il campo 'note' generico, lo rimuovo
      delete payload.note;
    } else if (nome === "fitopatie") {
      payload.tipo        = valOrNull(fd.get("tipo"));
      payload.sintomi     = valOrNull(fd.get("sintomi"));
      payload.prevenzione = valOrNull(fd.get("prevenzione"));
      payload.trattamento = valOrNull(fd.get("trattamento"));
    }

    try {
      if (item) {
        await app.api.put(`/${nome}/${item.id}`, payload);
        app.toast(`${etichettaSingolare(nome)} aggiornato`, "ok");
      } else {
        await app.api.post(`/${nome}`, payload);
        app.toast(`${etichettaSingolare(nome)} creato`, "ok");
      }
      app.cache.invalida(nome);
      // Se ho toccato i componenti, invalido anche la cache substrati
      // perché le card usano i colori dei componenti per i pallini.
      if (nome === "componenti") app.cache.invalida("substrati");
      app.modal.chiudi();
      await renderTabella(nome);
    } catch (e) {
      app.toast("Errore nel salvataggio: " + e.message, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Cancellazione
  // ----------------------------------------------------------------
  async function elimina(nome, id) {
    const item = stato[nome].items.find((x) => x.id === id);
    if (!item) return;

    const testoConferma = item.preimpostato
      ? `Stai per eliminare "${item.nome}", che è un record preimpostato.\n\n` +
        `Dopo la cancellazione non sarà più disponibile come default. Vuoi procedere?`
      : `Vuoi davvero eliminare "${item.nome}"? L'operazione non è reversibile.`;

    if (!(await app.conferma(testoConferma))) return;

    try {
      await app.api.del(`/${nome}/${id}`);
      app.toast("Eliminato", "ok");
      app.cache.invalida(nome);
      if (nome === "componenti") app.cache.invalida("substrati");
      await renderTabella(nome);
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      const isFK = ["conflitto", "foreign", "constraint", "vincolo"]
        .some((k) => msg.includes(k));
      if (isFK) {
        app.toast("Impossibile eliminare: questo elemento è usato da uno o più vasi", "errore");
      } else {
        app.toast("Errore nella cancellazione: " + e.message, "errore");
      }
    }
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  function valOrNull(v) {
    if (v == null) return null;
    const s = v.toString().trim();
    return s === "" ? null : s;
  }
  function numOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ----------------------------------------------------------------
  // Wiring dei pulsanti di testa e delle ricerche
  // ----------------------------------------------------------------
  document.getElementById("btn-aggiungi-fertilizzante")
    .addEventListener("click", () => apriForm("fertilizzanti"));
  document.getElementById("btn-aggiungi-substrato")
    .addEventListener("click", () => apriForm("substrati"));
  document.getElementById("btn-aggiungi-componente")
    .addEventListener("click", () => apriForm("componenti"));
  document.getElementById("btn-aggiungi-fitopatia")
    .addEventListener("click", () => apriForm("fitopatie"));

  ["fertilizzanti","substrati","componenti","fitopatie"].forEach((nome) => {
    stato[nome].ricerca.addEventListener("input", (e) => {
      stato[nome].filtro = e.target.value;
      disegnaLista(nome);
    });
  });

  // ----------------------------------------------------------------
  // Registrazione del modulo
  // ----------------------------------------------------------------
  window.app.moduli.tabelle = { render, renderTabella };
})();
