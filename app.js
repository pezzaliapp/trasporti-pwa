/* Trasporti PWA — logica base + Batch/Convertitori + GEO + km/disagiata + Ricarico/Margine
   - Carica JSON (articoli + tariffe + geo province)
   - Calcolo: PALLET / GROUPAGE  (GLS disabilitato se non configurato)
   - Province filtrate per Regione via geo_provinces.json (fix: reset provincia non valida)
*/

const $ = (id) => document.getElementById(id);

let DB = {
  articles: [],
  palletRates: null,
  groupageRates: null,
};

let GEO = null; // geo_provinces.json (Regione -> Province)
let allProvincesFallback = []; // popolato in init()

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
  outClientPrice: $("outClientPrice"),
  markupMode: $("markupMode"),
  markupPct: $("markupPct"),
  outText: $("outText"),
  outAlerts: $("outAlerts"),

  dbgArticle: $("dbgArticle"),
  dbgRules: $("dbgRules"),
  dbgData: $("dbgData"),
  pwaStatus: $("pwaStatus"),

  // Batch / Convertitori (UI presente ma gestione “light”)
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
  batchCSVResult: null,
};

function moneyEUR(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(v);
}

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

function pctToFactor(pct){
  return (parseFloat(pct) || 0) / 100;
}

function computeClientPrice(cost, mode, pct){
  if(cost === null || cost === undefined || Number.isNaN(cost)) return null;
  const p = pctToFactor(pct);
  if(!mode || mode === "RICARICO"){
    return round2(cost * (1 + p));
  }
  // MARGINE: Prezzo = Costo / (1 - p)
  if(p >= 1) return null;
  return round2(cost / (1 - p));
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

/* -------------------- NORMALIZZAZIONI (FIX PROVINCE) -------------------- */

function normalizeProvince(p){
  const x = (p || "").trim().toUpperCase();
  // compatibilità storica: se qualcuno usa CI, riportiamo a SU
  if (x === "CI") return "SU";
  return x;
}

function normalizeRegion(r){
  return (r || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeCode(s){
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/* -------------------- touched tracking -------------------- */

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

/* -------------------- UI -------------------- */

function applyServiceUI(){
  const s = UI.service.value;

  show(UI.provinceField, s === "GROUPAGE");
  show(UI.palletTypeField, s === "PALLET");
  show(UI.lmField, s === "GROUPAGE");
  show(UI.quintaliField, s === "GROUPAGE");
  show(UI.palletCountField, s === "GROUPAGE");

  if(UI.outAlerts) UI.outAlerts.innerHTML = "";
  if(UI.outCost) UI.outCost.textContent = "—";
  if(UI.outClientPrice) UI.outClientPrice.textContent = "—";
  if(UI.btnCopy) UI.btnCopy.disabled = true;
}

function addAlert(title, text){
  if(!UI.outAlerts) return;
  const div = document.createElement("div");
  div.className = "alert";
  div.innerHTML = `<b>${title}</b><div>${text}</div>`;
  UI.outAlerts.appendChild(div);
}

function searchArticles(q){
  const t = (q || "").trim().toLowerCase();
  if(!t) return DB.articles.slice(0, 200);

  const tn = normalizeCode(t);

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

/* -------------------- GEO: province per regione (FIX RESET) -------------------- */

function refreshProvincesByRegion(){
  const regKey = normalizeRegion(UI.region.value);
  const allowed =
    (GEO && regKey && GEO[regKey] && Array.isArray(GEO[regKey]))
      ? GEO[regKey].map(normalizeProvince)
      : null;

  const prev = normalizeProvince(UI.province.value);

  if(allowed && allowed.length){
    fillSelect(UI.province, uniq(allowed), { placeholder: "— Seleziona Provincia —" });

    // se la provincia precedente non è ammessa -> reset
    if(prev && !allowed.includes(prev)){
      UI.province.value = "";
    } else if(prev) {
      UI.province.value = prev;
    }
  } else {
    fillSelect(UI.province, allProvincesFallback, { placeholder: "— Seleziona Provincia —" });
    if(prev) UI.province.value = prev;
  }
}

/* -------------------- GROUPAGE: RISOLUZIONE PROVINCE "RAGGRUPPATE" -------------------- */

function tokenizeProvinceGroupKey(key){
  const raw = (key || "").toUpperCase();
  const tokens = raw.split(/[\s\/,\-;]+/g).map(t => t.trim()).filter(Boolean);
  return tokens.filter(t => /^[A-Z]{2}$/.test(t)).map(normalizeProvince);
}

function resolveGroupageProvinceKey(province2){
  const prov = normalizeProvince(province2);
  const provinces = DB.groupageRates?.provinces || {};

  if(provinces[prov]) return { key: prov, data: provinces[prov], matchedBy: "direct" };

  for(const k of Object.keys(provinces)){
    const toks = tokenizeProvinceGroupKey(k);
    if(toks.includes(prov)){
      return { key: k, data: provinces[k], matchedBy: "group" };
    }
  }

  return null;
}

/* -------------------- AUTO-FILL DA ARTICOLO (Option B) -------------------- */

function onArticleChange(){
  const art = selectedArticle();
  if(!art) return;

  const r = art.rules || {};
  const pack = art.pack || {};
  const pt = (pack.palletType || "").trim();

  // PALLET: auto taglia bancale (solo se non toccato a mano)
  if(pt && UI.palletType && !isTouched(UI.palletType)){
    UI.palletType.value = pt;
  }

  // GROUPAGE: compila SOLO se esplicitamente previsto (Option B)
  if(UI.service?.value === "GROUPAGE"){
    const allowAuto =
      !!r.groupageAutoFill ||
      (r.groupageLm != null) ||
      (r.groupageQuintali != null) ||
      (r.groupagePalletCount != null);

    if(!allowAuto){
      if(UI.lm && !isTouched(UI.lm)) UI.lm.value = "0";
      if(UI.quintali && !isTouched(UI.quintali)) UI.quintali.value = "0";
      if(UI.palletCount && !isTouched(UI.palletCount)) UI.palletCount.value = "0";
    } else {
      if(r.groupageLm != null && UI.lm && !isTouched(UI.lm)){
        UI.lm.value = String(r.groupageLm);
      }

      if(UI.quintali && !isTouched(UI.quintali)){
        if(r.groupageQuintali != null){
          UI.quintali.value = String(r.groupageQuintali);
        } else if(pack.weightKg != null && !Number.isNaN(Number(pack.weightKg))){
          UI.quintali.value = String(round2(Number(pack.weightKg) / 100));
        }
      }

      if(UI.palletCount && !isTouched(UI.palletCount)){
        if(r.groupagePalletCount != null){
          UI.palletCount.value = String(r.groupagePalletCount);
        } else if(pt){
          // se c'è bancale “di fatto” e non specificato, default = 1
          UI.palletCount.value = "1";
        }
      }
    }

    // noSponda -> disabilita sponda
    if(UI.optSponda){
      if(r.noSponda){
        UI.optSponda.checked = false;
        UI.optSponda.disabled = true;
      } else {
        UI.optSponda.disabled = false;
      }
    }
  } else {
    if(UI.optSponda) UI.optSponda.disabled = false;
  }

  // aggiorna output in tempo reale dopo auto-fill
  scheduleCalc();
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
  if(!palletType) return { cost:null, rules:["Manca taglia bancale"], alerts:["Seleziona tipo bancale (MINI/QUARTER/HALF/... )."] };

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

  if(art?.rules?.forceQuote){
    rules.push("forceQuote");
    alerts.push(art.rules.forceQuoteReason || "Nota: quotazione/preventivo.");
  }

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

function computeGroupage({province, lm, quintali, palletCount, opts, art}){
  const rules = [];
  const alerts = [];

  if(!province) return { cost:null, rules:["Manca provincia"], alerts:["Seleziona una provincia."] };

  const resolved = resolveGroupageProvinceKey(province);
  if(!resolved){
    return { cost:null, rules:["Provincia non trovata"], alerts:[`Nessuna tariffa groupage per ${province}.`] };
  }

  const p = resolved.data;
  if(resolved.matchedBy === "group"){
    rules.push(`provGroup:${resolved.key}`);
    alerts.push(`Provincia ${province} tariffata come gruppo: ${resolved.key}`);
  }

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

  if(art?.rules?.forceQuote){
    rules.push("forceQuote");
    alerts.push(art.rules.forceQuoteReason || "Nota: quotazione/preventivo.");
  }

  return { cost: round2(base), rules, alerts };
}

function computeGLS(){
  return {
    cost: null,
    rules: ["GLS disabilitato"],
    alerts: ["Nel file Excel 2026 non esiste un tariffario GLS: calcolo non disponibile."]
  };
}

function buildSummary({service, region, province, art, qty, palletType, lm, quintali, palletCount, opts, cost, clientPrice, markupMode, markupPct, rules, alerts, extraNote}){
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

  const pct = parseFloat(markupPct) || 0;
  if(pct > 0){
    lines.push(`${(markupMode === "MARGINE") ? "Margine" : "Ricarico"}: ${pct}%`);
    lines.push(`PREZZO CLIENTE: ${moneyEUR(clientPrice)}`);
  } else {
    lines.push(`PREZZO CLIENTE: ${moneyEUR(cost)}`);
  }

  if(rules?.length) lines.push(`REGOLE: ${rules.join(" | ")}`);

  if(alerts?.length){
    lines.push("");
    lines.push("ATTENZIONE:");
    for(const a of alerts) lines.push(`- ${a}`);
  }

  return lines.join("\n");
}

/* -------------------- UI ACTIONS -------------------- */

let _calcTimer = null;
function scheduleCalc(){
  // Calcolo "live" (flag/inputs) senza martellare: piccolo debounce
  if(_calcTimer) clearTimeout(_calcTimer);
  _calcTimer = setTimeout(() => {
    try { onCalc(); } catch(e) { /* noop */ }
  }, 120);
}

function onCalc(){

  const service = UI.service.value;

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

  if(UI.dbgArticle){
    UI.dbgArticle.textContent = art
      ? JSON.stringify({id:art.id, code:art.code, pack:art.pack || {}, rules: art.rules || {}}, null, 0)
      : "—";
  }

  let out;
  if(service === "PALLET"){
    out = computePallet({ region, palletType, qty, opts, art });
  } else if(service === "GROUPAGE"){
    out = computeGroupage({ province, lm, quintali, palletCount, opts, art });
  } else {
    out = computeGLS();
  }

  // prezzo cliente
  const markupMode = UI.markupMode?.value || "RICARICO";
  const markupPct = UI.markupPct?.value || "0";
  const clientPrice = computeClientPrice(out.cost, markupMode, markupPct);

  if(UI.outCost) UI.outCost.textContent = moneyEUR(out.cost);
  if(UI.outClientPrice){
    const pct = parseFloat(markupPct) || 0;
    UI.outClientPrice.textContent = moneyEUR(pct > 0 ? clientPrice : out.cost);
  }

  if(UI.outAlerts) UI.outAlerts.innerHTML = "";
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
    clientPrice,
    markupMode,
    markupPct,
    rules: out.rules || [],
    alerts: out.alerts || [],
    extraNote: UI.extraNote.value || ""
  });

  if(UI.outText) UI.outText.textContent = summary;
  if(UI.dbgRules) UI.dbgRules.textContent = (out.rules || []).join(", ") || "—";

  if(UI.btnCopy){
    UI.btnCopy.disabled = !summary;
    UI.btnCopy.dataset.copy = summary;
  }
}

async function onCopy(){
  const text = UI.btnCopy?.dataset.copy || "";
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
      if(UI.pwaStatus) UI.pwaStatus.textContent = "Offline-ready: sì";
    } catch {
      if(UI.pwaStatus) UI.pwaStatus.textContent = "Offline-ready: no";
    }
  } else {
    if(UI.pwaStatus) UI.pwaStatus.textContent = "Offline-ready: n/d";
  }

  // Load datasets
  DB.articles = await loadJSON("data/articles.json");
  DB.palletRates = await loadJSON("data/pallet_rates_by_region.json");
  DB.groupageRates = await loadJSON("data/groupage_rates.json");

  // GEO
  try{
    GEO = await loadJSON("data/geo_provinces.json");
  } catch {
    GEO = null;
  }

  // Regions
  const regions = DB.palletRates?.meta?.regions || Object.keys(DB.palletRates.rates || {});
  fillSelect(UI.region, regions, { placeholder: "— Seleziona Regione —" });

  // Fallback provinces da chiavi groupage
  const provFromGroupageKeys = [];
  const groupKeys = Object.keys(DB.groupageRates?.provinces || {});
  for(const k of groupKeys){
    provFromGroupageKeys.push(...tokenizeProvinceGroupKey(k));
    if(/^[A-Z]{2}$/.test(k.toUpperCase().trim())) provFromGroupageKeys.push(normalizeProvince(k));
  }
  allProvincesFallback = uniq(provFromGroupageKeys);
  fillSelect(UI.province, allProvincesFallback, { placeholder: "— Seleziona Provincia —" });

  // Pallet types
  const palletTypes =
    DB.palletRates?.meta?.palletTypes ||
    (regions[0] && DB.palletRates?.rates?.[regions[0]] ? Object.keys(DB.palletRates.rates[regions[0]]) : []);
  fillSelect(UI.palletType, palletTypes, { placeholder: "— Seleziona tipo bancale —" });

  // Articles
  renderArticleList("");

  // touched tracking
  if(UI.palletType) UI.palletType.addEventListener("change", () => markTouched(UI.palletType));
  if(UI.lm) UI.lm.addEventListener("input", () => markTouched(UI.lm));
  if(UI.quintali) UI.quintali.addEventListener("input", () => markTouched(UI.quintali));
  if(UI.palletCount) UI.palletCount.addEventListener("input", () => markTouched(UI.palletCount));

  // Events core
  if(UI.service) UI.service.addEventListener("change", () => { applyServiceUI(); onArticleChange(); });
  if(UI.q) UI.q.addEventListener("input", () => renderArticleList(UI.q.value));
  if(UI.article) UI.article.addEventListener("change", () => { onArticleChange(); onCalc(); });
  if(UI.btnCalc) UI.btnCalc.addEventListener("click", onCalc);
  if(UI.btnCopy) UI.btnCopy.addEventListener("click", onCopy);
  if(UI.markupPct) UI.markupPct.addEventListener("input", onCalc);
  if(UI.markupMode) UI.markupMode.addEventListener("change", onCalc);

  // Calcolo live: aggiornamento immediato quando cambi quantità/flag/parametri
  if(UI.qty) UI.qty.addEventListener("input", scheduleCalc);
  if(UI.palletType) UI.palletType.addEventListener("change", scheduleCalc);
  if(UI.lm) UI.lm.addEventListener("input", scheduleCalc);
  if(UI.quintali) UI.quintali.addEventListener("input", scheduleCalc);
  if(UI.palletCount) UI.palletCount.addEventListener("input", scheduleCalc);

  if(UI.kmOver) UI.kmOver.addEventListener("input", scheduleCalc);
  if(UI.optDisagiata) UI.optDisagiata.addEventListener("change", scheduleCalc);
  if(UI.optPreavviso) UI.optPreavviso.addEventListener("change", scheduleCalc);
  if(UI.optAssicurazione) UI.optAssicurazione.addEventListener("change", scheduleCalc);
  if(UI.optSponda) UI.optSponda.addEventListener("change", scheduleCalc);
  if(UI.extraNote) UI.extraNote.addEventListener("input", scheduleCalc);

  // Province by region (FIX: usa normalizeRegion + reset provincia non valida)
  if(UI.region){
    UI.region.addEventListener("change", () => {
      refreshProvincesByRegion();
      onCalc();
    });
  }

  if(UI.province){
    UI.province.addEventListener("change", () => {
      const v = normalizeProvince(UI.province.value);
      if(UI.province.value !== v) UI.province.value = v;
      onCalc();
    });
  }

  // Applica filtro province già al primo load
  refreshProvincesByRegion();

  applyServiceUI();

  if(UI.outText) UI.outText.textContent = "Pronto. Seleziona servizio, destinazione e articolo, poi Calcola.";
  if(UI.dbgData) UI.dbgData.textContent = `articoli=${DB.articles.length} | regioni=${regions.length} | province=${(allProvincesFallback||[]).length}`;

  // primo calc “soft” (non obbligatorio, ma aggiorna prezzo cliente se markup > 0)
  onCalc();
}

window.addEventListener("DOMContentLoaded", init);
