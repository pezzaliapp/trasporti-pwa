/* Trasporti PWA — logica base
   - Carica JSON (articoli + tariffe)
   - Calcolo: PALLET / GROUPAGE / GLS
   - Regole note: forceQuote, suggestGLS, noSponda ecc.
*/

const $ = (id) => document.getElementById(id);

let DB = {
  articles: [],
  palletRates: null,
  groupageRates: null,
};

const UI = {
  service: $("service"),
  region: $("region"),
  province: $("province"),
  provinceField: $("provinceField"),
  q: $("q"),
  article: $("article"),
  qty: $("qty"),
  palletType: $("palletType"),
  palletTypeField: $("palletTypeField"),
  lm: $("lm"),
  lmField: $("lmField"),
  quintali: $("quintali"),
  quintaliField: $("quintaliField"),
  palletCount: $("palletCount"),
  palletCountField: $("palletCountField"),
  optPreavviso: $("optPreavviso"),
  optAssicurazione: $("optAssicurazione"),
  optSponda: $("optSponda"),
  extraNote: $("extraNote"),
  btnCalc: $("btnCalc"),
  btnCopy: $("btnCopy"),

  outCost: $("outCost"),
  outText: $("outText"),
  outAlerts: $("outAlerts"),

  dbgArticle: $("dbgArticle"),
  dbgRules: $("dbgRules"),
  dbgData: $("dbgData"),
  pwaStatus: $("pwaStatus"),
};

function moneyEUR(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(v);
}

function show(el, yes){ el.style.display = yes ? "" : "none"; }

async function loadJSON(path){
  const r = await fetch(path, { cache: "no-store" });
  if(!r.ok) throw new Error(`Impossibile caricare ${path}`);
  return r.json();
}

function uniq(arr){ return [...new Set(arr)].sort((a,b)=>a.localeCompare(b)); }

function fillSelect(select, items, {placeholder="— Seleziona —", valueKey=null, labelKey=null} = {}){
  select.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder;
  select.appendChild(o0);

  for (const it of items){
    const o = document.createElement("option");
    if (typeof it === "string"){
      o.value = it; o.textContent = it;
    } else {
      o.value = valueKey ? it[valueKey] : String(it);
      o.textContent = labelKey ? it[labelKey] : String(it);
    }
    select.appendChild(o);
  }
}

function applyServiceUI(){
  const s = UI.service.value;

  // province only for groupage in this MVP (configurabile)
  show(UI.provinceField, s === "GROUPAGE");
  show(UI.palletTypeField, s === "PALLET");
  show(UI.lmField, s === "GROUPAGE");
  show(UI.quintaliField, s === "GROUPAGE");
  show(UI.palletCountField, s === "GROUPAGE");

  // reset outputs
  UI.outAlerts.innerHTML = "";
  UI.outCost.textContent = "—";
  UI.btnCopy.disabled = true;
}

function searchArticles(q){
  const t = (q || "").trim().toLowerCase();
  if(!t) return DB.articles.slice(0, 200);
  return DB.articles
    .filter(a => (
      (a.code||"").toLowerCase().includes(t) ||
      (a.name||"").toLowerCase().includes(t) ||
      (a.brand||"").toLowerCase().includes(t) ||
      (a.tags||[]).join(" ").toLowerCase().includes(t)
    ))
    .slice(0, 200);
}

function selectedArticle(){
  const id = UI.article.value;
  return DB.articles.find(a => a.id === id) || null;
}

function addAlert(title, text){
  const div = document.createElement("div");
  div.className = "alert";
  div.innerHTML = `<b>${title}</b><div>${text}</div>`;
  UI.outAlerts.appendChild(div);
}

function computePallet({region, palletType, qty, opts, art}){
  const rules = [];
  const alerts = [];

  if(!region) return { cost:null, rules:["Manca regione"], alerts:["Seleziona una regione."] };
  if(!palletType) return { cost:null, rules:["Manca taglia bancale"], alerts:["Seleziona taglia bancale (MINI/HALF/...)."] };

  // regole articolo
  if(art?.rules?.forceQuote){
    alerts.push(`Articolo marcato "preventivo necessario": ${art.rules.forceQuoteReason || "vedi note"}`);
    return { cost:null, rules:["forceQuote"], alerts };
  }
  if(art?.rules?.suggestGLS){
    alerts.push(`Articolo consigliato GLS: ${art.rules.suggestGLSReason || "vedi note"}`);
  }
  if(art?.rules?.noSponda){
    alerts.push(`NO SPONDA: per questo articolo potrebbe non essere possibile. Valuta groupage / preventivo.`);
  }

  const rate = DB.palletRates?.rates?.[region]?.[palletType];
  if(rate == null){
    return { cost:null, rules:["Tariffa non trovata"], alerts:[`Nessuna tariffa bancale per ${region} / ${palletType}.`] };
  }

  // regola max 5 plt per spedizione (se qty significa bancali)
  const maxPerShipment = DB.palletRates?.meta?.maxPalletsPerShipment ?? 5;
  const shipments = Math.ceil(qty / maxPerShipment);
  if(shipments > 1){
    rules.push(`split:${shipments}`);
    alerts.push(`Quantità > ${maxPerShipment}: l'app divide in ${shipments} spedizioni (stima).`);
  }

  let base = rate * qty;

  // opzioni (meta configurabili)
  if(opts.preavviso && DB.palletRates?.meta?.preavviso_fee != null){
    base += DB.palletRates.meta.preavviso_fee * shipments;
    rules.push("preavviso");
  }
  if(opts.assicurazione && DB.palletRates?.meta?.insurance_pct != null){
    base = base * (1 + DB.palletRates.meta.insurance_pct);
    rules.push("assicurazione");
  }

  return { cost: round2(base), rules, alerts };
}

function matchGroupageBracket(value, brackets){
  // brackets: [{min, max, price}] — max può essere null
  for(const b of brackets){
    const okMin = value >= (b.min ?? 0);
    const okMax = (b.max == null) ? true : value <= b.max;
    if(okMin && okMax) return b.price;
  }
  return null;
}

function computeGroupage({province, lm, quintali, palletCount, opts, art}){
  const rules = [];
  const alerts = [];

  if(!province) return { cost:null, rules:["Manca provincia"], alerts:["Seleziona una provincia."] };

  if(art?.rules?.forceQuote){
    alerts.push(`Articolo marcato "preventivo necessario": ${art.rules.forceQuoteReason || "vedi note"}`);
    return { cost:null, rules:["forceQuote"], alerts };
  }

  const p = DB.groupageRates?.provinces?.[province];
  if(!p) return { cost:null, rules:["Provincia non trovata"], alerts:[`Nessuna tariffa groupage per ${province}.`] };

  // scegliamo il migliore tra le tre metriche disponibili (se valorizzate)
  const candidates = [];

  if(lm > 0 && Array.isArray(p.linearMeters)){
    const price = matchGroupageBracket(lm, p.linearMeters);
    if(price != null) candidates.push({mode:"lm", price});
  }
  if(quintali > 0 && Array.isArray(p.quintali)){
    const price = matchGroupageBracket(quintali, p.quintali);
    if(price != null) candidates.push({mode:"quintali", price});
  }
  if(palletCount > 0 && Array.isArray(p.pallets)){
    const price = matchGroupageBracket(palletCount, p.pallets);
    if(price != null) candidates.push({mode:"pallets", price});
  }

  if(candidates.length === 0){
    return {
      cost:null,
      rules:["Nessun parametro groupage valido"],
      alerts:["Inserisci almeno uno tra Metri lineari / Quintali / N° bancali con valori coerenti alle fasce."]
    };
  }

  // scegli il minimo come “miglior costo”
  candidates.sort((a,b)=>a.price-b.price);
  let base = candidates[0].price;
  rules.push(`best:${candidates[0].mode}`);

  // sponda / extra
  if(opts.sponda && DB.groupageRates?.meta?.liftgate_fee != null){
    base += DB.groupageRates.meta.liftgate_fee;
    rules.push("sponda");
  }
  if(opts.preavviso && DB.groupageRates?.meta?.preavviso_fee != null){
    base += DB.groupageRates.meta.preavviso_fee;
    rules.push("preavviso");
  }
  if(opts.assicurazione && DB.groupageRates?.meta?.insurance_pct != null){
    base = base * (1 + DB.groupageRates.meta.insurance_pct);
    rules.push("assicurazione");
  }

  // note articolo
  if(art?.rules?.noSponda){
    alerts.push(`NO SPONDA: attenzione, potrebbe non essere possibile in consegna.`);
  }
  if(art?.rules?.suggestGLS){
    alerts.push(`Articolo consigliato GLS: ${art.rules.suggestGLSReason || "vedi note"}`);
  }

  return { cost: round2(base), rules, alerts };
}

function computeGLS({region, qty, opts, art}){
  const rules = [];
  const alerts = [];

  // GLS in questo MVP: costo base per regione + moltiplicatore qty
  // (puoi sostituirlo con listino reale GLS oppure “solo suggerimento”)
  if(!region) return { cost:null, rules:["Manca regione"], alerts:["Seleziona una regione."] };

  const base = DB.palletRates?.meta?.gls_base_by_region?.[region];
  if(base == null){
    alerts.push("Listino GLS non configurato per questa regione (metti i valori nel JSON meta.gls_base_by_region).");
    return { cost:null, rules:["GLS non configurato"], alerts };
  }

  let cost = base * qty;
  rules.push("gls");

  if(art?.rules?.forceQuote){
    alerts.push(`Articolo marcato "preventivo necessario": ${art.rules.forceQuoteReason || "vedi note"}`);
  }
  if(opts.assicurazione && DB.palletRates?.meta?.insurance_pct != null){
    cost = cost * (1 + DB.palletRates.meta.insurance_pct);
    rules.push("assicurazione");
  }

  return { cost: round2(cost), rules, alerts };
}

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

function buildSummary({service, region, province, art, qty, palletType, lm, quintali, palletCount, opts, cost, rules, alerts, extraNote}){
  const lines = [];
  lines.push(`SERVIZIO: ${service}`);
  lines.push(`DESTINAZIONE: ${province ? (province + " / ") : ""}${region || "—"}`);
  lines.push(`ARTICOLO: ${art ? `${art.brand || ""} ${art.name} (${art.code || art.id})`.trim() : "—"}`);
  lines.push(`QTA: ${qty}`);

  if(service === "PALLET") lines.push(`Bancale: ${palletType || "—"}`);
  if(service === "GROUPAGE"){
    lines.push(`Groupage: LM=${lm} | q.li=${quintali} | plt=${palletCount}`);
  }

  const optList = [];
  if(opts.preavviso) optList.push("preavviso");
  if(opts.assicurazione) optList.push("assicurazione");
  if(opts.sponda) optList.push("sponda");
  lines.push(`OPZIONI: ${optList.length ? optList.join(", ") : "nessuna"}`);

  if(extraNote?.trim()) lines.push(`NOTE EXTRA: ${extraNote.trim()}`);

  lines.push("");
  lines.push(`COSTO STIMATO: ${moneyEUR(cost)}`);
  if(rules?.length) lines.push(`REGOLE: ${rules.join(" | ")}`);

  if(alerts?.length){
    lines.push("");
    lines.push("ATTENZIONE:");
    for(const a of alerts) lines.push(`- ${a}`);
  }

  return lines.join("\n");
}

async function init(){
  // PWA
  if ("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("sw.js");
      UI.pwaStatus.textContent = "Offline-ready: sì";
    } catch(e){
      UI.pwaStatus.textContent = "Offline-ready: no";
    }
  } else {
    UI.pwaStatus.textContent = "Offline-ready: n/d";
  }

  // Load datasets
  DB.articles = await loadJSON("data/articles.json");
  DB.palletRates = await loadJSON("data/pallet_rates_by_region.json");
  DB.groupageRates = await loadJSON("data/groupage_rates.json");

  // Regions from pallet rates meta list or keys
  const regions = DB.palletRates?.meta?.regions || Object.keys(DB.palletRates.rates || {});
  fillSelect(UI.region, regions, { placeholder: "— Seleziona Regione —" });

  // Provinces from groupage
  const provinces = Object.keys(DB.groupageRates?.provinces || {});
  fillSelect(UI.province, provinces, { placeholder: "— Seleziona Provincia —" });

  // Pallet types
  const palletTypes = DB.palletRates?.meta?.palletTypes || ["MINI","QUARTER","HALF","MEDIUM","FULL"];
  fillSelect(UI.palletType, palletTypes, { placeholder: "— Seleziona Taglia —" });

  // Articles initial
  renderArticleList("");

  UI.service.addEventListener("change", applyServiceUI);
  UI.q.addEventListener("input", () => renderArticleList(UI.q.value));
  UI.btnCalc.addEventListener("click", onCalc);
  UI.btnCopy.addEventListener("click", onCopy);

  applyServiceUI();
  UI.outText.textContent = "Pronto. Seleziona servizio, destinazione e articolo, poi Calcola.";
  UI.dbgData.textContent = `articoli=${DB.articles.length} | regioni=${regions.length} | province=${provinces.length}`;
}

function renderArticleList(q){
  const items = searchArticles(q).map(a => ({
    id: a.id,
    label: `${a.brand ? a.brand + " — " : ""}${a.name}${a.code ? " · " + a.code : ""}`
  }));
  fillSelect(UI.article, items, { placeholder: "— Seleziona articolo —", valueKey:"id", labelKey:"label" });
}

function onCalc(){
  const service = UI.service.value;
  const region = UI.region.value;
  const province = UI.province.value;
  const qty = Math.max(1, parseInt(UI.qty.value || "1", 10));
  const palletType = UI.palletType.value;

  const lm = parseFloat(UI.lm.value || "0");
  const quintali = parseFloat(UI.quintali.value || "0");
  const palletCount = parseFloat(UI.palletCount.value || "0");

  const opts = {
    preavviso: UI.optPreavviso.checked,
    assicurazione: UI.optAssicurazione.checked,
    sponda: UI.optSponda.checked
  };

  const art = selectedArticle();

  // debug
  UI.dbgArticle.textContent = art ? JSON.stringify({id:art.id, code:art.code, rules:art.rules || {}}, null, 0) : "—";

  let out;
  if(service === "PALLET"){
    out = computePallet({ region, palletType, qty, opts, art });
  } else if(service === "GROUPAGE"){
    out = computeGroupage({ province, lm, quintali, palletCount, opts, art });
  } else {
    out = computeGLS({ region, qty, opts, art });
  }

  // alerts UI
  UI.outAlerts.innerHTML = "";
  (out.alerts || []).forEach(a => addAlert("Nota / Controllo", a));

  const summary = buildSummary({
    service,
    region,
    province,
    art,
    qty,
    palletType,
    lm, quintali, palletCount,
    opts,
    cost: out.cost,
    rules: out.rules || [],
    alerts: out.alerts || [],
    extraNote: UI.extraNote.value || ""
  });

  UI.outText.textContent = summary;
  UI.outCost.textContent = moneyEUR(out.cost);

  UI.dbgRules.textContent = (out.rules || []).join(", ") || "—";

  UI.btnCopy.disabled = !summary;
  UI.btnCopy.dataset.copy = summary;
}

async function onCopy(){
  const text = UI.btnCopy.dataset.copy || "";
  if(!text) return;
  try{
    await navigator.clipboard.writeText(text);
    UI.btnCopy.textContent = "Copiato ✓";
    setTimeout(()=> UI.btnCopy.textContent="Copia riepilogo", 1000);
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

window.addEventListener("DOMContentLoaded", init);
