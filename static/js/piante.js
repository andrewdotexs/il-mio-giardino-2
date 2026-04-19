/* ============================================================
   piante.js - Modulo "Le Mie Piante"
   ============================================================
   Gestisce l'anagrafica delle specie di piante, con scheda
   agronomica estesa che rispecchia il design a tab della v1.0.

   Struttura del modulo:

     1. Stato locale (lista cached + filtro di ricerca)
     2. render() / disegnaLista()  → lista di card
     3. apriDettaglio(id)           → modal READ-ONLY a 4 tab
                                      (Concimazione, Substrato,
                                       Esposizione, Cure)
     4. apriForm(pianta)            → form di insert/edit con
                                      gruppi che rispecchiano
                                      le tab del dettaglio
     5. salva() / elimina()         → operazioni API
     6. Helpers                     → opzioni(), numOrNull(), ecc.

   Flusso di interazione:

     - tocco la card             → dettaglio a tab
     - tocco la matita (card)    → form di modifica
     - tocco il cestino (card)   → elimina con conferma
     - tocco la matita (dettaglio) → form di modifica

   I campi sono molti (circa 30) ma il form li organizza in
   sei gruppi visuali, quindi l'utente può scrollare e compilare
   solo quelli che gli interessano. Tutti i nuovi campi sono
   opzionali: il nome_comune resta l'unico obbligatorio.
   ============================================================ */

(function () {
  "use strict";

  // ----------------------------------------------------------------
  // Stato locale
  // ----------------------------------------------------------------
  let piante = [];
  let filtro = "";

  const lista = document.getElementById("lista-piante");
  const inputRicerca = document.getElementById("ricerca-piante");

  // ----------------------------------------------------------------
  // Rendering della lista
  // ----------------------------------------------------------------
  async function render() {
    try {
      piante = await app.cache.carica("piante", true);
      disegnaLista();
    } catch (e) {
      app.toast("Errore nel caricamento piante: " + e.message, "errore");
    }
  }

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

    lista.innerHTML = visibili.map((p) => cardHtml(p)).join("");

    // Event delegation: un solo listener sulla lista gestisce tutti
    // i click. Se l'utente tocca matita o cestino, eseguo l'azione
    // specifica; altrimenti apro il dettaglio. stopPropagation
    // impedisce che un click sulla matita apra anche il dettaglio.
    lista.onclick = (ev) => {
      const btnAzione = ev.target.closest("[data-azione]");
      const card = ev.target.closest(".card");
      if (!card) return;
      const id = Number(card.dataset.id);

      if (btnAzione) {
        ev.stopPropagation();
        const pianta = piante.find((x) => x.id === id);
        if (btnAzione.dataset.azione === "modifica") apriForm(pianta);
        else if (btnAzione.dataset.azione === "elimina") elimina(id);
        return;
      }

      apriDettaglio(id);
    };
  }

  // Card minimale: nome, sottotitolo, qualche chip riassuntiva e un
  // hint "tocca per dettagli". Il ricco si vede nella scheda.
  function cardHtml(p) {
    const chips = [];
    if (p.tipo_ambiente) {
      chips.push(`<span class="chip">${app.escapeHtml(p.tipo_ambiente)}</span>`);
    }
    if (p.difficolta) {
      const cls = {facile:"alt", media:"info", difficile:"warn"}[p.difficolta] || "";
      chips.push(`<span class="chip ${cls}">${app.escapeHtml(p.difficolta)}</span>`);
    }
    if (p.stagionalita) {
      chips.push(`<span class="chip">${app.escapeHtml(p.stagionalita)}</span>`);
    }
    if (p.luce) {
      chips.push(`<span class="chip info">${app.escapeHtml(p.luce)}</span>`);
    }
    if (p.temp_min_c != null && p.temp_max_c != null) {
      chips.push(`<span class="chip">${p.temp_min_c}°C / ${p.temp_max_c}°C</span>`);
    }

    return `
      <div class="card card-cliccabile" data-id="${p.id}">
        <div class="card-header">
          <div>
            <h3 class="card-titolo">${app.escapeHtml(p.nome_comune)}</h3>
            ${p.nome_scientifico
              ? `<div class="card-sottotitolo">${app.escapeHtml(p.nome_scientifico)}</div>`
              : p.famiglia
                ? `<div class="card-sottotitolo">${app.escapeHtml(p.famiglia)}</div>`
                : ""}
          </div>
          <div class="card-azioni">
            <button class="btn-icona" data-azione="modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="elimina"  title="Elimina">🗑️</button>
          </div>
        </div>
        <div class="card-meta">
          ${chips.join("")}
        </div>
        <div class="card-hint muted">tocca per dettagli</div>
      </div>
    `;
  }

  // ================================================================
  // DETTAGLIO A TAB (read-only)
  // ================================================================
  function apriDettaglio(id) {
    const p = piante.find((x) => x.id === id);
    if (!p) return;

    // Sottotitolo: preferisco famiglia, poi tipo_ambiente testuale,
    // poi nome scientifico. Stile "voce enciclopedica breve".
    let sottotitolo = "";
    if (p.famiglia) sottotitolo = p.famiglia;
    else if (p.tipo_ambiente === "interno") sottotitolo = "Pianta d'interno";
    else if (p.tipo_ambiente === "esterno") sottotitolo = "Pianta da esterno";
    else if (p.nome_scientifico) sottotitolo = p.nome_scientifico;

    // Chip header: ambiente, difficoltà, stagionalità
    const chipsHeader = [];
    if (p.tipo_ambiente) {
      chipsHeader.push(`<span class="chip">${app.escapeHtml(p.tipo_ambiente)}</span>`);
    }
    if (p.difficolta) {
      const cls = {facile:"alt", media:"info", difficile:"warn"}[p.difficolta] || "";
      chipsHeader.push(`<span class="chip ${cls}">${app.escapeHtml(p.difficolta)}</span>`);
    }
    if (p.stagionalita) {
      chipsHeader.push(`<span class="chip">${app.escapeHtml(p.stagionalita)}</span>`);
    }

    // "Linea fertilizzanti" va su una riga a sé, sotto le tab —
    // come nello screenshot v1.0 dove "BioBizz" era separata.
    const chipLinea = p.linea_fertilizzanti
      ? `<div class="scheda-chip-linea">
           <span class="chip">${app.escapeHtml(p.linea_fertilizzanti)}</span>
         </div>`
      : "";

    const html = `
      <div class="scheda-dettaglio">
        <div class="scheda-header">
          <div class="scheda-header-icona">🌿</div>
          <div class="scheda-header-titolo">
            <h2>${app.escapeHtml(p.nome_comune)}</h2>
            ${sottotitolo ? `<div class="muted">${app.escapeHtml(sottotitolo)}</div>` : ""}
          </div>
          <div class="scheda-header-azioni">
            <button class="btn-icona" data-azione="scheda-modifica" title="Modifica">✏️</button>
            <button class="btn-icona" data-azione="scheda-chiudi"   title="Chiudi">✕</button>
          </div>
        </div>

        ${chipsHeader.length ? `<div class="scheda-chips-header">${chipsHeader.join("")}</div>` : ""}

        <div class="tabs-scheda">
          <button class="tab-scheda attiva" data-tab="concimazione">Concimazione</button>
          <button class="tab-scheda"        data-tab="substrato">Substrato</button>
          <button class="tab-scheda"        data-tab="esposizione">Esposizione</button>
          <button class="tab-scheda"        data-tab="cure">Cure</button>
        </div>

        ${chipLinea}

        <div class="pannello-scheda attivo" data-pannello="concimazione">
          ${pannelloConcimazione(p)}
        </div>
        <div class="pannello-scheda" data-pannello="substrato">
          ${pannelloSubstrato(p)}
        </div>
        <div class="pannello-scheda" data-pannello="esposizione">
          ${pannelloEsposizione(p)}
        </div>
        <div class="pannello-scheda" data-pannello="cure">
          ${pannelloCure(p)}
        </div>
      </div>
    `;

    app.modal.apri(html);

    document.querySelector('[data-azione="scheda-chiudi"]')
      .addEventListener("click", () => app.modal.chiudi());
    document.querySelector('[data-azione="scheda-modifica"]')
      .addEventListener("click", () => {
        app.modal.chiudi();
        apriForm(p);
      });

    document.querySelectorAll(".tab-scheda").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        document.querySelectorAll(".tab-scheda").forEach((b) => b.classList.remove("attiva"));
        document.querySelectorAll(".pannello-scheda").forEach((p) => p.classList.remove("attivo"));
        btn.classList.add("attiva");
        document.querySelector(`.pannello-scheda[data-pannello="${target}"]`)
          .classList.add("attivo");
      });
    });
  }

  // Helper: costruisce una riga "etichetta | valore" solo se valorizzata.
  // Le righe vuote scompaiono del tutto, mantenendo pulita la scheda.
  function riga(etichetta, valore) {
    if (valore == null || valore === "") return "";
    return `
      <div class="scheda-riga">
        <div class="scheda-etichetta">${app.escapeHtml(etichetta)}</div>
        <div class="scheda-valore">${app.escapeHtml(String(valore))}</div>
      </div>`;
  }

  function pannelloConcimazione(p) {
    const righe = [
      riga("Periodo",   p.conc_periodo),
      riga("Frequenza", p.conc_frequenza),
      riga("Concime",   p.conc_tipo),
      riga("Stop",      p.conc_stop),
      riga("Note",      p.conc_note),
    ].join("");
    return righe || schedaVuota("concimazione");
  }

  function pannelloSubstrato(p) {
    // pH: compongo "min – max" se entrambi, altrimenti solo quello valorizzato
    let phText = "";
    if (p.ph_ideale_min != null && p.ph_ideale_max != null) {
      phText = `${p.ph_ideale_min} – ${p.ph_ideale_max}`;
    } else if (p.ph_ideale_min != null) {
      phText = `min ${p.ph_ideale_min}`;
    } else if (p.ph_ideale_max != null) {
      phText = `max ${p.ph_ideale_max}`;
    }

    const righe = [
      riga("Terreno",      p.sub_descrizione),
      riga("pH ideale",    phText),
      riga("Vaso",         p.vaso_consigliato),
      riga("Rinvaso",      p.rinvaso_frequenza),
      riga("Terreno vivo", p.terreno_vivo),
    ].join("");
    return righe || schedaVuota("substrato");
  }

  function pannelloEsposizione(p) {
    // Luce: preferisco la descrizione estesa, fallback sul valore strutturato
    const luceText = p.luce_descrizione || p.luce;

    // Temperatura: compongo dal range numerico
    let tempText = "";
    if (p.temp_min_c != null && p.temp_max_c != null) {
      tempText = `${p.temp_min_c}–${p.temp_max_c}°C`;
    } else if (p.temp_min_c != null) {
      tempText = `≥ ${p.temp_min_c}°C`;
    } else if (p.temp_max_c != null) {
      tempText = `≤ ${p.temp_max_c}°C`;
    }

    // Umidità: descrizione se presente, sennò il numerico formattato
    let umidText = p.umidita_descrizione;
    if (!umidText && p.umidita_ottimale != null) {
      umidText = `${p.umidita_ottimale}%`;
    }

    const righe = [
      riga("Luce",         luceText),
      riga("Sole diretto", p.sole_diretto),
      riga("Temperatura",  tempText),
      riga("Umidità",      umidText),
    ].join("");
    return righe || schedaVuota("esposizione");
  }

  function pannelloCure(p) {
    const righe = [
      riga("Annaffiatura", p.annaffiatura),
      riga("Potatura",     p.potatura),
      riga("Parassiti",    p.parassiti),
      riga("Da sapere",    p.da_sapere),
    ].join("");
    return righe || schedaVuota("cure");
  }

  function schedaVuota(sezione) {
    return `<div class="scheda-vuota muted">
      Nessuna informazione di <strong>${sezione}</strong> per questa pianta.
      Tocca ✏️ per compilarla.
    </div>`;
  }

  // ================================================================
  // FORM DI INSERIMENTO / MODIFICA
  // ================================================================
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
                     placeholder="Es: Sanseviera, Ficus, Pothos..."
                     value="${app.escapeHtml(p.nome_comune)}" />
            </div>
            <div class="campo full">
              <label for="fp-nome-scientifico">Nome scientifico</label>
              <input id="fp-nome-scientifico" name="nome_scientifico"
                     placeholder="Es: Dracaena trifasciata"
                     value="${app.escapeHtml(p.nome_scientifico)}" />
            </div>
            <div class="campo">
              <label for="fp-famiglia">Famiglia</label>
              <input id="fp-famiglia" name="famiglia"
                     placeholder="Es: Asparagaceae"
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
          <h3 class="form-gruppo-titolo">🏷️ Classificazione rapida</h3>
          <p class="muted form-gruppo-hint">
            Queste tre voci compaiono come chip nell'intestazione della scheda.
          </p>
          <div class="form-grid">
            <div class="campo">
              <label for="fp-difficolta">Difficoltà</label>
              <select id="fp-difficolta" name="difficolta">
                <option value="">—</option>
                ${opzioni(["facile","media","difficile"], p.difficolta)}
              </select>
            </div>
            <div class="campo">
              <label for="fp-stagionalita">Stagionalità</label>
              <input id="fp-stagionalita" name="stagionalita"
                     placeholder="Es: Stop invernale, Sempre attiva, Annuale"
                     value="${app.escapeHtml(p.stagionalita)}" />
            </div>
            <div class="campo full">
              <label for="fp-linea-fert">Linea di fertilizzazione consigliata</label>
              <input id="fp-linea-fert" name="linea_fertilizzanti"
                     placeholder="Es: BioBizz, COMPO, COMPO + Cifo"
                     value="${app.escapeHtml(p.linea_fertilizzanti)}" />
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">💧 Concimazione</h3>
          <div class="form-grid">
            <div class="campo">
              <label for="fp-conc-periodo">Periodo</label>
              <input id="fp-conc-periodo" name="conc_periodo"
                     placeholder="Es: Aprile – Settembre"
                     value="${app.escapeHtml(p.conc_periodo)}" />
            </div>
            <div class="campo">
              <label for="fp-conc-freq">Frequenza</label>
              <input id="fp-conc-freq" name="conc_frequenza"
                     placeholder="Es: 1x al mese"
                     value="${app.escapeHtml(p.conc_frequenza)}" />
            </div>
            <div class="campo full">
              <label for="fp-conc-tipo">Tipo di concime</label>
              <input id="fp-conc-tipo" name="conc_tipo"
                     placeholder="Es: Liquido succulente, 1/2 dose"
                     value="${app.escapeHtml(p.conc_tipo)}" />
            </div>
            <div class="campo full">
              <label for="fp-conc-stop">Regola di stop</label>
              <input id="fp-conc-stop" name="conc_stop"
                     placeholder="Es: Stop completo in autunno/inverno"
                     value="${app.escapeHtml(p.conc_stop)}" />
            </div>
            <div class="campo full">
              <label for="fp-conc-note">Note sulla concimazione</label>
              <textarea id="fp-conc-note" name="conc_note"
                        placeholder="Accortezze, avvertenze, periodi particolari...">${app.escapeHtml(p.conc_note)}</textarea>
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">🪨 Substrato e rinvaso</h3>
          <div class="form-grid">
            <div class="campo full">
              <label for="fp-sub-desc">Terreno / substrato ideale</label>
              <input id="fp-sub-desc" name="sub_descrizione"
                     placeholder="Es: Substrato per succulente e cactus, ben drenante"
                     value="${app.escapeHtml(p.sub_descrizione)}" />
            </div>
            <div class="campo">
              <label for="fp-ph-min">pH ideale min</label>
              <input id="fp-ph-min" name="ph_ideale_min" type="number" step="0.1" min="0" max="14"
                     value="${valOrEmpty(p.ph_ideale_min)}" />
            </div>
            <div class="campo">
              <label for="fp-ph-max">pH ideale max</label>
              <input id="fp-ph-max" name="ph_ideale_max" type="number" step="0.1" min="0" max="14"
                     value="${valOrEmpty(p.ph_ideale_max)}" />
            </div>
            <div class="campo full">
              <label for="fp-vaso">Vaso consigliato</label>
              <input id="fp-vaso" name="vaso_consigliato"
                     placeholder="Es: Terracotta con foro di drenaggio, non troppo grande"
                     value="${app.escapeHtml(p.vaso_consigliato)}" />
            </div>
            <div class="campo full">
              <label for="fp-rinvaso">Frequenza di rinvaso</label>
              <input id="fp-rinvaso" name="rinvaso_frequenza"
                     placeholder="Es: Ogni 2-3 anni o quando le radici escono dal vaso"
                     value="${app.escapeHtml(p.rinvaso_frequenza)}" />
            </div>
            <div class="campo full">
              <label for="fp-terreno-vivo">Terreno vivo</label>
              <textarea id="fp-terreno-vivo" name="terreno_vivo"
                        placeholder="Humus di lombrico, micorrize, suggerimenti bio...">${app.escapeHtml(p.terreno_vivo)}</textarea>
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">☀️ Esposizione</h3>
          <div class="form-grid">
            <div class="campo full">
              <label for="fp-luce">Esposizione luminosa (categoria)</label>
              <select id="fp-luce" name="luce">
                <option value="">—</option>
                ${opzioni(
                  ["pieno sole","mezz'ombra","ombra","luminoso indiretto"],
                  p.luce
                )}
              </select>
            </div>
            <div class="campo full">
              <label for="fp-luce-desc">Descrizione della luce</label>
              <input id="fp-luce-desc" name="luce_descrizione"
                     placeholder="Es: Luce indiretta brillante; tollera poca luce ma cresce lentamente"
                     value="${app.escapeHtml(p.luce_descrizione)}" />
            </div>
            <div class="campo full">
              <label for="fp-sole">Sole diretto</label>
              <input id="fp-sole" name="sole_diretto"
                     placeholder="Es: Evitare sole diretto estivo — brucia le foglie"
                     value="${app.escapeHtml(p.sole_diretto)}" />
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
            <div class="campo">
              <label for="fp-umid">Umidità ottimale (%)</label>
              <input id="fp-umid" name="umidita_ottimale" type="number" min="0" max="100"
                     value="${valOrEmpty(p.umidita_ottimale)}" />
            </div>
            <div class="campo full">
              <label for="fp-umid-desc">Descrizione dell'umidità</label>
              <input id="fp-umid-desc" name="umidita_descrizione"
                     placeholder="Es: Bassa; non nebulizzare"
                     value="${app.escapeHtml(p.umidita_descrizione)}" />
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">🌱 Cure</h3>
          <div class="form-grid">
            <div class="campo full">
              <label for="fp-annaff">Annaffiatura</label>
              <textarea id="fp-annaff" name="annaffiatura"
                        placeholder="Quando e come annaffiare, variazioni stagionali...">${app.escapeHtml(p.annaffiatura)}</textarea>
            </div>
            <div class="campo full">
              <label for="fp-potatura">Potatura</label>
              <textarea id="fp-potatura" name="potatura"
                        placeholder="Cosa e quando potare, foglie secche, cimature...">${app.escapeHtml(p.potatura)}</textarea>
            </div>
            <div class="campo full">
              <label for="fp-parassiti">Parassiti e fitopatie tipici</label>
              <textarea id="fp-parassiti" name="parassiti"
                        placeholder="Es: Cocciniglia e ragnetto rosso; trattare con olio di neem">${app.escapeHtml(p.parassiti)}</textarea>
            </div>
            <div class="campo full">
              <label for="fp-sapere">Da sapere</label>
              <textarea id="fp-sapere" name="da_sapere"
                        placeholder="Curiosità, consigli chiave, avvertenze...">${app.escapeHtml(p.da_sapere)}</textarea>
            </div>
          </div>
        </div>

        <div class="form-gruppo">
          <h3 class="form-gruppo-titolo">📝 Note generali</h3>
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

    document.getElementById("chiudi-modal-pianta").onclick = app.modal.chiudi;
    document.getElementById("btn-annulla-pianta").onclick = app.modal.chiudi;

    document.getElementById("form-pianta").addEventListener("submit", (e) => {
      e.preventDefault();
      salva(e.target, pianta?.id);
    });
  }

  // ----------------------------------------------------------------
  // Salvataggio
  // ----------------------------------------------------------------
  // Costruisco il payload da FormData. Per i testuali uso strOrNull,
  // per i numerici numOrNull: entrambi normalizzano stringhe vuote in
  // null, così il DB salva NULL invece di "" (più corretto
  // semanticamente e permette IS NULL nelle query future).
  async function salva(form, id) {
    const fd = new FormData(form);
    const data = {
      // Identificazione
      nome_comune:      fd.get("nome_comune")?.trim(),
      nome_scientifico: strOrNull(fd.get("nome_scientifico")),
      famiglia:         strOrNull(fd.get("famiglia")),
      tipo_ambiente:    fd.get("tipo_ambiente") || "esterno",

      // Classificazione
      difficolta:          strOrNull(fd.get("difficolta")),
      stagionalita:        strOrNull(fd.get("stagionalita")),
      linea_fertilizzanti: strOrNull(fd.get("linea_fertilizzanti")),

      // Concimazione
      conc_periodo:   strOrNull(fd.get("conc_periodo")),
      conc_frequenza: strOrNull(fd.get("conc_frequenza")),
      conc_tipo:      strOrNull(fd.get("conc_tipo")),
      conc_stop:      strOrNull(fd.get("conc_stop")),
      conc_note:      strOrNull(fd.get("conc_note")),

      // Substrato
      sub_descrizione:    strOrNull(fd.get("sub_descrizione")),
      ph_ideale_min:      numOrNull(fd.get("ph_ideale_min")),
      ph_ideale_max:      numOrNull(fd.get("ph_ideale_max")),
      vaso_consigliato:   strOrNull(fd.get("vaso_consigliato")),
      rinvaso_frequenza:  strOrNull(fd.get("rinvaso_frequenza")),
      terreno_vivo:       strOrNull(fd.get("terreno_vivo")),

      // Esposizione
      luce:                strOrNull(fd.get("luce")),
      luce_descrizione:    strOrNull(fd.get("luce_descrizione")),
      sole_diretto:        strOrNull(fd.get("sole_diretto")),
      temp_min_c:          numOrNull(fd.get("temp_min_c")),
      temp_max_c:          numOrNull(fd.get("temp_max_c")),
      umidita_ottimale:    numOrNull(fd.get("umidita_ottimale")),
      umidita_descrizione: strOrNull(fd.get("umidita_descrizione")),

      // Cure
      annaffiatura: strOrNull(fd.get("annaffiatura")),
      potatura:     strOrNull(fd.get("potatura")),
      parassiti:    strOrNull(fd.get("parassiti")),
      da_sapere:    strOrNull(fd.get("da_sapere")),

      // Note generali
      note: strOrNull(fd.get("note")),
    };

    if (!data.nome_comune) {
      app.toast("Il nome comune è obbligatorio", "errore");
      return;
    }

    // Sanity check leggero: se entrambi i pH sono valorizzati min <= max
    if (data.ph_ideale_min != null && data.ph_ideale_max != null
        && data.ph_ideale_min > data.ph_ideale_max) {
      app.toast("pH min non può essere superiore a pH max", "errore");
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
  // Cancellazione
  // ----------------------------------------------------------------
  async function elimina(id) {
    const p = piante.find((x) => x.id === id);
    if (!p) return;
    if (!(await app.conferma(
        `Vuoi eliminare "${p.nome_comune}"? L'operazione non è reversibile.`
        + `\n\nSe esistono vasi associati, la cancellazione verrà bloccata.`))) return;

    try {
      await app.api.del("/piante/" + id);
      app.toast("Pianta eliminata");
      app.cache.invalida("piante");
      await render();
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      const isFK = ["conflitto", "foreign", "constraint", "vincolo"]
        .some((k) => msg.includes(k));
      if (isFK) {
        app.toast("Impossibile eliminare: esistono vasi che usano questa pianta", "errore");
      } else {
        app.toast("Errore nella cancellazione: " + e.message, "errore");
      }
    }
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  function opzioni(lista, attuale) {
    return lista
      .map((v) => `<option value="${app.escapeHtml(v)}" ${v === attuale ? "selected" : ""}>${app.escapeHtml(v)}</option>`)
      .join("");
  }

  function valOrEmpty(v) {
    return v == null || v === "" ? "" : v;
  }

  function strOrNull(v) {
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
  // Wiring
  // ----------------------------------------------------------------
  document.getElementById("btn-aggiungi-pianta")
    .addEventListener("click", () => apriForm());

  inputRicerca.addEventListener("input", (e) => {
    filtro = e.target.value;
    disegnaLista();
  });

  window.app.moduli.piante = { render };
})();
