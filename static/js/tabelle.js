/* ============================================================
   tabelle.js - Modulo "Gestione Tabelle"
   ============================================================
   Questo modulo gestisce le tre anagrafiche di supporto:

     - Fertilizzanti  (marca, NPK, tipo, forma, dosaggio)
     - Substrati      (con composizione come array JSON)
     - Fitopatie      (sintomi, prevenzione, trattamento)

   Differenza con piante.js: qui abbiamo tre dataset distinti
   e tre form diversi, quindi invece di uno stato monolitico
   tengo una mappa `stato[nome]` con una "sotto-sezione" per
   ciascuna tabella. La funzione `renderTabella(nome)` è un
   dispatcher che delega al disegno della sotto-tabella giusta.

   Il modulo si registra come window.app.moduli.tabelle ed
   espone due entry point:

     - render():            chiamato da app quando si entra
                            nella sezione "tabelle"; capisce
                            quale sotto-pannello è attivo e
                            lo ridisegna.
     - renderTabella(nome): chiamato da app quando si clicca
                            su una tab interna.
   ============================================================ */

(function () {
  "use strict";

  // ----------------------------------------------------------------
  // Stato locale
  // ----------------------------------------------------------------
  // Tengo una chiave per ogni sotto-tabella. Ognuna ha la propria
  // lista cached (riempita dal server) e il proprio filtro di ricerca.
  // Separarli è importante: se l'utente sta filtrando "BioBizz" nei
  // fertilizzanti e poi passa ai substrati, non voglio che il filtro
  // si trascini dietro.
  const stato = {
    fertilizzanti: { items: [], filtro: "", lista: null, ricerca: null },
    substrati:     { items: [], filtro: "", lista: null, ricerca: null },
    fitopatie:     { items: [], filtro: "", lista: null, ricerca: null },
  };

  // Bind dei riferimenti DOM una volta sola. Sono fissi nel markup,
  // quindi possiamo cercarli all'avvio e riusarli.
  stato.fertilizzanti.lista   = document.getElementById("lista-fertilizzanti");
  stato.fertilizzanti.ricerca = document.getElementById("ricerca-fertilizzanti");
  stato.substrati.lista       = document.getElementById("lista-substrati");
  stato.substrati.ricerca     = document.getElementById("ricerca-substrati");
  stato.fitopatie.lista       = document.getElementById("lista-fitopatie");
  stato.fitopatie.ricerca     = document.getElementById("ricerca-fitopatie");

  // ----------------------------------------------------------------
  // Dispatcher principale
  // ----------------------------------------------------------------
  // Scopre quale pannello è attivo leggendo la DOM (più robusto che
  // tenere un secondo stato sincronizzato con app.mostraTabella).
  function tabellaAttiva() {
    const pannello = document.querySelector(".pannello-tabella.attivo");
    if (!pannello) return "fertilizzanti";
    return pannello.id.replace("pannello-", "");
  }

  async function render() {
    // Quando entro nella sezione "tabelle" in generale, ridisegno
    // solo la sotto-tabella attualmente visibile; le altre verranno
    // caricate pigramente al primo switch.
    await renderTabella(tabellaAttiva());
  }

  async function renderTabella(nome) {
    if (!stato[nome]) return;
    try {
      // force=true perché dopo una modifica altrove (es. un vaso che
      // aggiunge una nuova fitopatia) i contatori potrebbero essere
      // disallineati. Ricaricare è economico, queste tabelle sono brevi.
      stato[nome].items = await app.cache.carica(nome, true);
      disegnaLista(nome);
    } catch (e) {
      app.toast(`Errore nel caricamento ${nome}: ${e.message}`, "errore");
    }
  }

  // ----------------------------------------------------------------
  // Rendering delle liste
  // ----------------------------------------------------------------
  // Un singolo disegnaLista con dispatch interno: la card cambia
  // struttura a seconda del tipo di record ma la logica di filtro
  // e di vuoto-stato è identica, quindi la fattorizzo qui.
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

    // Delego i click sulle card a un singolo listener sulla lista;
    // così non devo ri-attaccare handler ogni volta che ridisegno.
    s.lista.onclick = (ev) => {
      const btn = ev.target.closest("[data-azione]");
      if (!btn) return;
      const id = Number(btn.closest(".card").dataset.id);
      const azione = btn.dataset.azione;
      if (azione === "modifica") apriForm(nome, id);
      else if (azione === "elimina") elimina(nome, id);
    };
  }

  // Ogni tabella ha campi diversi, ma la ricerca funziona allo
  // stesso modo: concateniamo i campi testuali rilevanti e
  // cerchiamo il termine dentro (case-insensitive, accent-insensitive).
  function matchFiltro(nome, it, q) {
    let blob = "";
    if (nome === "fertilizzanti") {
      blob = `${it.nome || ""} ${it.marca || ""} ${it.tipo || ""} ${it.forma || ""}`;
    } else if (nome === "substrati") {
      blob = `${it.nome || ""} ${it.descrizione || ""}`;
      // Cerco anche nei nomi dei componenti della composizione,
      // così se uno cerca "perlite" trova i substrati che ne contengono.
      if (Array.isArray(it.composizione)) {
        blob += " " + it.composizione.map((c) => c.componente || "").join(" ");
      }
    } else if (nome === "fitopatie") {
      blob = `${it.nome || ""} ${it.tipo || ""} ${it.sintomi || ""}`;
    }
    return app.normalizza(blob).includes(q);
  }

  function etichetta(nome) {
    return { fertilizzanti: "Fertilizzanti", substrati: "Substrati", fitopatie: "Fitopatie" }[nome];
  }

  // ----------------------------------------------------------------
  // Card per ciascun tipo
  // ----------------------------------------------------------------
  function cardHtml(nome, it) {
    if (nome === "fertilizzanti") return cardFertilizzante(it);
    if (nome === "substrati")     return cardSubstrato(it);
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
            ? `<span class="chip">${f.dosaggio_ml_per_l} ml/L</span>`
            : ""}
          ${f.preimpostato
            ? `<span class="chip warn" title="Record preimpostato">★ preset</span>`
            : ""}
        </div>
        ${f.note ? `<div class="muted" style="margin-top:8px;font-size:.85rem">${app.escapeHtml(f.note)}</div>` : ""}
      </div>`;
  }

  function cardSubstrato(s) {
    // La composizione: riassumo in chip i primi 3-4 componenti per non
    // saturare la card, poi un "+N" se ce ne sono altri.
    const comp = Array.isArray(s.composizione) ? s.composizione : [];
    const chipsComp = comp.slice(0, 4).map((c) =>
      `<span class="chip">${app.escapeHtml(c.componente || "?")}${
        c.percentuale != null ? ` ${c.percentuale}%` : ""
      }</span>`
    ).join("");
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
            ? `<span class="chip">pH ${s.ph_min}–${s.ph_max}</span>`
            : ""}
          ${s.drenaggio ? `<span class="chip alt">drenaggio ${app.escapeHtml(s.drenaggio)}</span>` : ""}
          ${s.preimpostato
            ? `<span class="chip warn" title="Substrato preimpostato">★ preset</span>`
            : ""}
        </div>
        ${s.note ? `<div class="muted" style="margin-top:8px;font-size:.85rem">${app.escapeHtml(s.note)}</div>` : ""}
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
          ${f.preimpostato
            ? `<span class="chip warn" title="Fitopatia preimpostata">★ preset</span>`
            : ""}
        </div>
      </div>`;
  }

  // ----------------------------------------------------------------
  // Form: apertura e dispatch
  // ----------------------------------------------------------------
  function apriForm(nome, id = null) {
    const item = id != null ? stato[nome].items.find((x) => x.id === id) : null;
    const isEdit = !!item;
    const titolo = `${isEdit ? "Modifica" : "Nuovo"} ${etichettaSingolare(nome)}`;

    // Costruisco il markup del form in base al tipo. Ogni costruttore
    // restituisce un blocco di <div class="form-gruppo">...</div> che
    // andrà infilato dentro un <form> comune con i pulsanti Salva/Annulla.
    let corpoForm = "";
    if (nome === "fertilizzanti") corpoForm = formFertilizzante(item);
    else if (nome === "substrati") corpoForm = formSubstrato(item);
    else if (nome === "fitopatie") corpoForm = formFitopatia(item);

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

    // Handler per i pulsanti di chiusura (sia quello in header che
    // quello "Annulla" in fondo: entrambi hanno data-chiudi).
    document.querySelectorAll("[data-chiudi]").forEach((b) =>
      b.addEventListener("click", () => app.modal.chiudi())
    );

    // I substrati hanno un'interazione extra: l'editor della
    // composizione. Lo attivo solo per loro.
    if (nome === "substrati") wiringComposizione(item);

    // Submit unico per tutti e tre i form: dentro salva() smistiamo
    // in base al `nome`.
    document.getElementById("form-tabella").addEventListener("submit", (ev) => {
      ev.preventDefault();
      salva(nome, item);
    });
  }

  function etichettaSingolare(nome) {
    return { fertilizzanti: "fertilizzante", substrati: "substrato", fitopatie: "fitopatia" }[nome];
  }

  // ----------------------------------------------------------------
  // Form: fertilizzante
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
            <input name="npk_n" type="number" step="0.1" min="0" max="100"
                   value="${v.npk_n ?? ""}" />
          </label>
          <label>
            <span>P (%)</span>
            <input name="npk_p" type="number" step="0.1" min="0" max="100"
                   value="${v.npk_p ?? ""}" />
          </label>
          <label>
            <span>K (%)</span>
            <input name="npk_k" type="number" step="0.1" min="0" max="100"
                   value="${v.npk_k ?? ""}" />
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
              ${["organico", "minerale", "organo-minerale", "biostimolante", "correttivo"]
                .map((t) => `<option value="${t}" ${v.tipo === t ? "selected" : ""}>${t}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            <span>Forma</span>
            <select name="forma">
              <option value="">— seleziona —</option>
              ${["liquido", "granulare", "polvere", "stick", "pellet", "hydro"]
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
  // Form: substrato
  // ----------------------------------------------------------------
  // Il punto delicato è la composizione: un array dinamico di
  // oggetti {componente, percentuale}. Uso un contenitore con un
  // wiring separato (vedi wiringComposizione) che aggiunge/rimuove
  // righe e tiene un contatore per generare nomi unici per gli input.
  function formSubstrato(s) {
    const v = s || {};
    const preset = !!v.preimpostato;
    const comp = Array.isArray(v.composizione) ? v.composizione : [];

    // Pre-disegno le righe iniziali della composizione (se sto
    // modificando un substrato esistente, le sue righe sono già qui;
    // altrimenti parto da una riga vuota per invitare l'utente).
    const righe = comp.length > 0 ? comp : [{ componente: "", percentuale: "" }];
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
              ${["scarso", "medio", "buono", "ottimo"]
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
          Aggiungi una riga per ogni componente del mix. Le percentuali sono
          indicative e non devono necessariamente sommare a 100%.
        </p>
        <div id="composizione-righe" data-prossimo="${righe.length}">
          ${righeHtml}
        </div>
        <button type="button" class="btn-secondario" id="btn-aggiungi-componente">
          + Aggiungi componente
        </button>
      </div>

      <div class="form-gruppo">
        <div class="form-gruppo-titolo">Parametri fisico-chimici</div>
        <div class="form-grid tre-colonne">
          <label>
            <span>WHC (%)</span>
            <input name="whc" type="number" step="0.1" min="0" max="100"
                   title="Water Holding Capacity — % d'acqua trattenuta dopo saturazione e drenaggio"
                   value="${v.whc ?? ""}" />
          </label>
          <label>
            <span>pH min</span>
            <input name="ph_min" type="number" step="0.1" min="0" max="14"
                   value="${v.ph_min ?? ""}" />
          </label>
          <label>
            <span>pH max</span>
            <input name="ph_max" type="number" step="0.1" min="0" max="14"
                   value="${v.ph_max ?? ""}" />
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

  // Markup di una singola riga di composizione. L'indice i serve
  // soltanto per generare name univoci (anche se alla raccolta dati
  // li leggeremo tutti scorrendo il DOM, quindi in realtà potremmo
  // anche farne a meno — ma aiuta il debugging).
  function rigaComposizioneHtml(i, c) {
    return `
      <div class="composizione-riga" data-riga="${i}">
        <input type="text" class="comp-nome"
               placeholder="Componente (es. torba, perlite)"
               value="${app.escapeHtml(c.componente || "")}" />
        <input type="number" class="comp-perc"
               placeholder="%" step="1" min="0" max="100"
               value="${c.percentuale ?? ""}" />
        <button type="button" class="btn-icona btn-rimuovi-componente" title="Rimuovi">🗑️</button>
      </div>`;
  }

  // Qui c'è il piccolo interruttore di logica che rende dinamica
  // la composizione: catturo i click sul contenitore (delega di
  // eventi) per i "rimuovi" e sul pulsante "+ Aggiungi componente"
  // per l'aggiunta. Il contatore `data-prossimo` evita collisioni
  // di indice con righe appena rimosse.
  function wiringComposizione(_item) {
    const cont = document.getElementById("composizione-righe");
    const btnAdd = document.getElementById("btn-aggiungi-componente");
    if (!cont || !btnAdd) return;

    btnAdd.addEventListener("click", () => {
      const prossimo = Number(cont.dataset.prossimo || "0");
      cont.insertAdjacentHTML("beforeend",
        rigaComposizioneHtml(prossimo, { componente: "", percentuale: "" }));
      cont.dataset.prossimo = String(prossimo + 1);
    });

    cont.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-rimuovi-componente");
      if (!btn) return;
      const riga = btn.closest(".composizione-riga");
      // Se è l'ultima riga rimasta, pulisco i campi invece di toglierla
      // del tutto: così l'editor non resta vuoto senza alcun input.
      if (cont.querySelectorAll(".composizione-riga").length === 1) {
        riga.querySelector(".comp-nome").value = "";
        riga.querySelector(".comp-perc").value = "";
      } else {
        riga.remove();
      }
    });
  }

  // Raccoglie l'array di composizione leggendo il DOM. Scarto
  // le righe completamente vuote (nome e percentuale entrambi vuoti)
  // per non salvare spazzatura. La percentuale diventa Number se
  // presente, altrimenti null.
  function raccogliComposizione() {
    const righe = document.querySelectorAll("#composizione-righe .composizione-riga");
    const out = [];
    righe.forEach((r) => {
      const comp = r.querySelector(".comp-nome").value.trim();
      const percStr = r.querySelector(".comp-perc").value.trim();
      if (!comp && !percStr) return;
      const perc = percStr === "" ? null : Number(percStr);
      out.push({
        componente: comp,
        percentuale: Number.isFinite(perc) ? perc : null,
      });
    });
    return out;
  }

  // ----------------------------------------------------------------
  // Form: fitopatia
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
              ${["fungina", "batterica", "virale", "parassita", "carenza", "fisiopatia"]
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

    // Estraggo i valori comuni (ogni form valorizza quelli che gli
    // servono; quelli non presenti restano undefined e il server
    // li gestirà come NULL).
    const payload = {
      nome:  (fd.get("nome") || "").toString().trim(),
      note:  valOrNull(fd.get("note")),
    };

    if (!payload.nome) {
      app.toast("Il nome è obbligatorio", "errore");
      return;
    }

    if (nome === "fertilizzanti") {
      payload.marca              = valOrNull(fd.get("marca"));
      payload.npk_n              = numOrNull(fd.get("npk_n"));
      payload.npk_p              = numOrNull(fd.get("npk_p"));
      payload.npk_k              = numOrNull(fd.get("npk_k"));
      payload.tipo               = valOrNull(fd.get("tipo"));
      payload.forma              = valOrNull(fd.get("forma"));
      payload.dosaggio_ml_per_l  = numOrNull(fd.get("dosaggio_ml_per_l"));
    } else if (nome === "substrati") {
      payload.descrizione = valOrNull(fd.get("descrizione"));
      payload.drenaggio   = valOrNull(fd.get("drenaggio"));
      payload.whc         = numOrNull(fd.get("whc"));
      payload.ph_min      = numOrNull(fd.get("ph_min"));
      payload.ph_max      = numOrNull(fd.get("ph_max"));
      payload.composizione = raccogliComposizione();

      // Sanity check leggero sul pH: se entrambi valorizzati, min <= max.
      if (payload.ph_min != null && payload.ph_max != null
          && payload.ph_min > payload.ph_max) {
        app.toast("pH min non può essere superiore a pH max", "errore");
        return;
      }
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
      // Invalido la cache globale della tabella toccata, così i form
      // dei vasi che la consumano ricaricheranno al prossimo accesso.
      app.cache.invalida(nome);
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

    // Se è un preset mostro una conferma un po' più forte, perché
    // Andrea potrebbe aspettarsi di ritrovare sempre i valori di default.
    const testoConferma = item.preimpostato
      ? `Stai per eliminare "${item.nome}", che è un record preimpostato.\n\n` +
        `Dopo la cancellazione non sarà più disponibile come default. Vuoi procedere?`
      : `Vuoi davvero eliminare "${item.nome}"? L'operazione non è reversibile.`;

    if (!(await app.conferma(testoConferma))) return;

    try {
      await app.api.del(`/${nome}/${id}`);
      app.toast("Eliminato", "ok");
      app.cache.invalida(nome);
      await renderTabella(nome);
    } catch (e) {
      // Se un fertilizzante o substrato è usato in un vaso, il server
      // restituisce 409 (IntegrityError per FK RESTRICT) con un messaggio
      // tipo "Conflitto di integrità: FOREIGN KEY constraint failed".
      // Rilevo i termini chiave per mostrare un avviso esplicativo.
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
  // Helpers interni
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
  // Wiring dei bottoni e delle ricerche
  // ----------------------------------------------------------------
  // Pulsanti "+ Aggiungi" in testa a ogni pannello
  document.getElementById("btn-aggiungi-fertilizzante")
    .addEventListener("click", () => apriForm("fertilizzanti"));
  document.getElementById("btn-aggiungi-substrato")
    .addEventListener("click", () => apriForm("substrati"));
  document.getElementById("btn-aggiungi-fitopatia")
    .addEventListener("click", () => apriForm("fitopatie"));

  // Campi di ricerca: aggiornano il filtro in memoria e ridisegnano
  // la lista senza rifare fetch.
  ["fertilizzanti", "substrati", "fitopatie"].forEach((nome) => {
    stato[nome].ricerca.addEventListener("input", (e) => {
      stato[nome].filtro = e.target.value;
      disegnaLista(nome);
    });
  });

  // ----------------------------------------------------------------
  // Registrazione del modulo presso app
  // ----------------------------------------------------------------
  window.app.moduli.tabelle = { render, renderTabella };
})();
