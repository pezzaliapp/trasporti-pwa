/* Trasporti PWA — logica base + Batch/Convertitori + GEO + km/disagiata
   - Carica JSON (articoli + tariffe + geo province)
   - Calcolo: PALLET / GROUPAGE  (GLS disabilitato se non configurato)
*/

const $ = (id) => document.getElementById(id);

let DB = {
  articles: [],
  palletRates: null,
  groupageRates: null,
};

let GEO = null; // geo_provinces.json (Regione -> Province)

const UI = {
  // Core
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

  // New fields
  kmOver: $("kmOver"),
  optDisagiata: $("optDisagiata"),

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

  // Batch / Convertitori
  fileArticlesCsv: $("fileArticlesCsv"),
  fileGeoCsv: $("fileGeoCsv"),
  fileOfferCsv: $("fileOfferCsv"),
  batchPickCheapest: $("batchPickCheapest"),
  batchUseArticlePallet: $("batchUseArticlePallet"),
  btnExportArticles: $("btnExportArticles"),
  btnExportGeo: $("btnExportGeo"),
  btnRunBatch: $("btnRunBatch"),
  btnExportBatch: $("btnExportBatch"),
  batchLog: $("batchLog"),
};

const MEM = {
  generatedArticlesJSON: null,
  generatedGeoJSON: null,
  batchCSVResult: null
};

function moneyEUR(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(v);
}

function show(el, yes){ if(el) el.style.display = yes ? "" : "none"; }

async function loadJSON(path){
  const r = await fetch(path, { cache: "no-store" });
  if(!r.ok) throw new Error(`Impossibile caricare ${path}`);
  return r.json();
}

function uniq(arr){ return [...new Set(arr)].sort((a,b)=>a.localeCompare(b)); }

function fillSelect(select, items, {placeholder="— Seleziona —", valueKey=null, labelKey=null} = {}){
  if(!select) return;
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

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

function normalizeProvince(p){
  const x = (p || "").trim().toUpperCase();
  if(x === "SU") return "CI";
  return x;
}

// ✅ NORMALIZZA REGIONE (per match con JSON in maiuscolo o nomi speciali)
function normalizeRegion(r){
  return (r || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

// ✅ NORMALIZZA CODICE ARTICOLO (MEC 820VDL == MEC820VDL)
function normalizeCode(s){
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // toglie spazi, trattini, ecc.
}

// flags "touched" (non sovrascrivere se l’utente modifica a mano)
function markTouched(el){
  if(!el) return;
  el.dataset.touched = "1";
}
function isTouched(el){
  return !!(el && el.dataset.touched === "1");
}
function clearTouched(el){
  if(!el) return;
  delete el.dataset.touched;
}

function applyServiceUI(){
  const s = UI.service.value;

  show(UI.provinceField, s === "GROUPAGE");
  show(UI.palletTypeField, s === "PALLET");
  show(UI.lmField, s === "GROUPAGE");
  show(UI.quintaliField, s === "GROUPAGE");
  show(UI.palletCountField, s === "GROUPAGE");

  if(UI.outAlerts) UI.outAlerts.innerHTML = "";
  if(UI.outCost) UI.outCost.textContent = "—";
  if(UI.btnCopy) UI.btnCopy.disabled = true;
}

function searchArticles(q){
  const t = (q || "").trim().toLowerCase();
  if(!t) return DB.articles.slice(0, 200);

  const tn = normalizeCode(t); // ✅ ricerca “smart”

  return DB.articles
    .filter(a => {
      const codeN = normalizeCode(a.code || "");
      const name = (a.name||"").toLowerCase();
      const brand = (a.brand||"").toLowerCase();
      const tags = (a.tags||[]).join(" ").toLowerCase();
      return (
        codeN.includes(tn) ||
        name.includes(t) ||
        brand.includes(t) ||
        tags.includes(t)
      );
    })
    .slice(0, 200);
}

function renderArticleList(q){
  const items = searchArticles(q).map(a => ({
    id: a.id,
    label: `${a.brand ? a.brand + " — " : ""}${a.name}${a.code ? " · " + a.code : ""}`
  }));
  fillSelect(UI.article, items, { placeholder: "— Seleziona articolo —", valueKey:"id", labelKey:"label" });
}

function selectedArticle(){
  const id = UI.article.value;
  return DB.articles.find(a => a.id === id) || null;
}

function addAlert(title, text){
  if(!UI.outAlerts) return;
  const div = document.createElement("div");
  div.className = "alert";
  div.innerHTML = `<b>${title}</b><div>${text}</div>`;
  UI.outAlerts.appendChild(div);
}

/* -------------------- AUTO-FILL DA ARTICOLO -------------------- */

function onArticleChange(){
  const art = selectedArticle();
  if(!art) return;

  // ✅ se l’articolo ha pack.palletType, compila automaticamente PALLET TYPE
  const pt = (art.pack?.palletType || "").trim();
  if(pt && UI.palletType){
    if(!isTouched(UI.palletType)){
      UI.palletType.value = pt;   // auto-fill
    }
  }

  // ✅ forza servizio PALLET se stai su GLS o se service è vuoto
  // (Equilibratrici/smontagomme/macchine => sempre bancale)
  if(UI.service){
    if(!UI.service.value || UI.service.value === "GLS"){
      UI.service.value = "PALLET";
      applyServiceUI();
    }
  }
}

/* -------------------- CALCOLO -------------------- */

function applyKmAndDisagiata({base, shipments=1, opts, rules, alerts, mode="GROUPAGE"}){
  const kmThreshold = DB.groupageRates?.meta?.km_threshold ?? 30;
  const kmSurcharge = DB.groupageRates?.meta?.km_surcharge_per_km ?? 0;
  const disFee = DB.groupageRates?.meta?.disagiata_surcharge ?? 0;

  const kmOver = Math.max(0, parseInt(opts?.kmOver || 0, 10) || 0);

  if(kmOver > 0){
    alerts.push(`Distanza extra indicata: +${kmOver} km (oltre ${kmThreshold} km). Verificare condizioni.`);
    if(kmSurcharge > 0){
      base += (kmOver * kmSurcharge) * (mode === "PALLET" ? shipments : 1);
      rules.push(`km+${kmOver}`);
    }
  }

  if(opts?.disagiata){
    alerts.push("Località disagiata: possibile extra / preventivo (flag).");
    if(disFee > 0){
      base += disFee * (mode === "PALLET" ? shipments : 1);
      rules.push("disagiata");
    }
  }

  return base;
}

function computePallet({region, palletType, qty, opts, art}){
  const rules = [];
  const alerts = [];

  if(!region) return { cost:null, rules:["Manca regione"], alerts:["Seleziona una regione."] };
  if(!palletType) return { cost:null, rules:["Manca taglia bancale"], alerts:["Seleziona tipo bancale (QUARTER/HALF/MEDIUM/...)."] };

  const rate = DB.palletRates?.rates?.[region]?.[palletType];
  if(rate == null){
    return { cost:null, rules:["Tariffa non trovata"], alerts:[`Nessuna tariffa bancale per ${region} / ${palletType}.`] };
  }

  const maxPerShipment = DB.palletRates?.meta?.maxPalletsPerShipment ?? 5;
  const shipments = Math.ceil(qty / maxPerShipment);
  if(shipments > 1){
    rules.push(`split:${shipments}`);
    alerts.push(`Quantità > ${maxPerShipment}: divisione in ${shipments} spedizioni (stima).`);
  }

  let base = rate * qty;

  if(opts.preavviso && DB.palletRates?.meta?.preavviso_fee != null){
    base += DB.palletRates.meta.preavviso_fee * shipments;
    rules.push("preavviso");
  }
  if(opts.assicurazione && DB.palletRates?.meta?.insurance_pct != null){
    base = base * (1 + DB.palletRates.meta.insurance_pct);
    rules.push("assicurazione");
  }

  base = applyKmAndDisagiata({ base, shipments, opts, rules, alerts, mode:"PALLET" });

  return { cost: round2(base), rules, alerts };
}

function matchGroupageBracket(value, brackets){
  for(const b of brackets){
    const okMin = value >= (b.min ?? 0);
    const okMax = (b.max == null) ? true : value <= b.max;
    if(okMin && okMax) return b.price;
  }
  return null;
}

function computeGroupage({province, lm, quintali, palletCount, opts}){
  const rules = [];
  const alerts = [];

  if(!province) return { cost:null, rules:["Manca provincia"], alerts:["Seleziona una provincia."] };

  const p = DB.groupageRates?.provinces?.[province];
  if(!p) return { cost:null, rules:["Provincia non trovata"], alerts:[`Nessuna tariffa groupage per ${province}.`] };

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

  candidates.sort((a,b)=>a.price-b.price);
  let base = candidates[0].price;
  rules.push(`best:${candidates[0].mode}`);

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

  base = applyKmAndDisagiata({ base, shipments:1, opts, rules, alerts, mode:"GROUPAGE" });

  return { cost: round2(base), rules, alerts };
}

// ✅ GLS: non c’è tariffario nel tuo Excel 2026 -> blocchiamo
function computeGLS(){
  return {
    cost: null,
    rules: ["GLS disabilitato"],
    alerts: ["Nel file Excel 2026 non esiste un tariffario GLS: calcolo non disponibile."]
  };
}

function buildSummary({service, region, province, art, qty, palletType, lm, quintali, palletCount, opts, cost, rules, alerts, extraNote}){
  const lines = [];
  lines.push(`SERVIZIO: ${service}`);
  lines.push(`DESTINAZIONE: ${province ? (province + " / ") : ""}${region || "—"}`);
  lines.push(`ARTICOLO: ${art ? `${art.brand || ""} ${art.name} (${art.code || art.id})`.trim() : "—"}`);
  lines.push(`QTA: ${qty}`);

  if(service === "PALLET") lines.push(`Bancale: ${palletType || "—"}`);
  if(service === "GROUPAGE") lines.push(`Groupage: LM=${lm} | q.li=${quintali} | plt=${palletCount}`);

  const optList = [];
  if(opts.preavviso) optList.push("preavviso");
  if(opts.assicurazione) optList.push("assicurazione");
  if(opts.sponda) optList.push("sponda");
  if(opts.disagiata) optList.push("disagiata");
  if((opts.kmOver||0) > 0) optList.push(`km+${opts.kmOver}`);
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

/* -------------------- BATCH OFFERTA (fix match code) -------------------- */

function findArticleByCode(code){
  const t = normalizeCode(code);
  if(!t) return null;
  return DB.articles.find(a => normalizeCode(a.code || "") === t) || null;
}

/* -------------------- UI ACTIONS -------------------- */

function onCalc(){
  const service = UI.service.value;

  // ✅ normalizza regione prima di cercare in JSON
  const region = normalizeRegion(UI.region.value);

  const province = normalizeProvince(UI.province.value);
  const qty = Math.max(1, parseInt(UI.qty.value || "1", 10));
  const palletType = (UI.palletType.value || "").trim();

  const lm = parseFloat(UI.lm.value || "0");
  const quintali = parseFloat(UI.quintali.value || "0");
  const palletCount = parseFloat(UI.palletCount.value || "0");

  const opts = {
    preavviso: !!UI.optPreavviso.checked,
    assicurazione: !!UI.optAssicurazione.checked,
    sponda: !!UI.optSponda.checked,
    disagiata: !!UI.optDisagiata?.checked,
    kmOver: parseInt(UI.kmOver?.value || "0", 10) || 0
  };

  const art = selectedArticle();

  UI.dbgArticle.textContent = art ? JSON.stringify({id:art.id, code:art.code, pack:art.pack || {}}, null, 0) : "—";

  let out;
  if(service === "PALLET"){
    out = computePallet({ region, palletType, qty, opts, art });
  } else if(service === "GROUPAGE"){
    out = computeGroupage({ province, lm, quintali, palletCount, opts, art });
  } else {
    out = computeGLS();
  }

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
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/* -------------------- INIT -------------------- */

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

  // GEO (province by region)
  try{
    GEO = await loadJSON("data/geo_provinces.json");
  } catch {
    GEO = null;
  }

  // Regions (usa meta.regions se presente)
  const regions = DB.palletRates?.meta?.regions || Object.keys(DB.palletRates.rates || {});
  fillSelect(UI.region, regions, { placeholder: "— Seleziona Regione —" });

  // Provinces
  const allProvinces = uniq(Object.keys(DB.groupageRates?.provinces || {}).map(normalizeProvince));
  fillSelect(UI.province, allProvinces, { placeholder: "— Seleziona Provincia —" });

  // Pallet types (usa meta.palletTypes se presente)
  const palletTypes = DB.palletRates?.meta?.palletTypes || Object.values(DB.palletRates?.rates?.[regions[0]] || {}).length ? Object.keys(DB.palletRates.rates[regions[0]]) : [];
  fillSelect(UI.palletType, palletTypes, { placeholder: "— Seleziona tipo bancale —" });

  // Articles
  renderArticleList("");

  // ✅ touched tracking (manual override)
  if(UI.palletType) UI.palletType.addEventListener("change", () => markTouched(UI.palletType));

  // Events
  UI.service.addEventListener("change", applyServiceUI);
  UI.q.addEventListener("input", () => renderArticleList(UI.q.value));
  UI.article.addEventListener("change", onArticleChange);
  UI.btnCalc.addEventListener("click", onCalc);
  UI.btnCopy.addEventListener("click", onCopy);

  // Filter provinces when region changes (attenzione: regioni nel JSON sono uppercase)
  UI.region.addEventListener("change", () => {
    const regRaw = UI.region.value;
    const reg = regRaw; // GEO potrebbe essere in formato diverso: qui non normalizzo per non rompere GEO
    const allowed = (GEO && reg && GEO[reg]) ? GEO[reg].map(normalizeProvince) : null;
    if(allowed && allowed.length){
      fillSelect(UI.province, uniq(allowed), { placeholder: "— Seleziona Provincia —" });
    } else {
      fillSelect(UI.province, allProvinces, { placeholder: "— Seleziona Provincia —" });
    }
  });

  UI.province.addEventListener("change", () => {
    const v = normalizeProvince(UI.province.value);
    if(UI.province.value !== v) UI.province.value = v;
  });

  applyServiceUI();
  UI.outText.textContent = "Pronto. Seleziona servizio, destinazione e articolo, poi Calcola.";
  UI.dbgData.textContent = `articoli=${DB.articles.length} | regioni=${regions.length} | province=${allProvinces.length}`;
}

window.addEventListener("DOMContentLoaded", init);
