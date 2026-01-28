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
  outClientPrice: $("outClientPrice"),
  markupMode: $("markupMode"),
  markupPct: $("markupPct"),
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

function pctToFactor(pct){
  const p = (parseFloat(pct) || 0) / 100;
  return p;
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
    .replace(/[^a-z0-9]/g, "");
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
  if(UI.outClientPrice) UI.outClientPrice.textContent = "—";
  if(UI.btnCopy) UI.btnCopy.disabled = true;
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

function addAlert(title, text){
  if(!UI.outAlerts) return;
  const div = document.createElement("div");
  div.className = "alert";
  div.innerHTML = `<b>${title}</b><div>${text}</div>`;
  UI.outAlerts.appendChild(div);
}

/* -------------------- GROUPAGE: RISOLUZIONE PROVINCE "RAGGRUPPATE" -------------------- */
/* Esempi chiavi Excel:
   - "FR LT"
   - "RI VT RM"
   - "BN-NA"
   - "AV-SA"
   - "MT / PZ"
*/
function tokenizeProvinceGroupKey(key){
  const raw = (key || "").toUpperCase();
  // split su spazi, slash, trattini, virgole, punto e virgola
  const tokens = raw.split(/[\s\/,\-;]+/g).map(t => t.trim()).filter(Boolean);
  // tieni solo token "tipo provincia" (2 lettere)
  return tokens.filter(t => /^[A-Z]{2}$/.test(t)).map(normalizeProvince);
}

function resolveGroupageProvinceKey(province2){
  const prov = normalizeProvince(province2);
  const provinces = DB.groupageRates?.provinces || {};

  // 1) match diretto
  if(provinces[prov]) return { key: prov, data: provinces[prov], matchedBy: "direct" };

  // 2) match dentro chiavi raggruppate
  for(const k of Object.keys(provinces)){
    const toks = tokenizeProvinceGroupKey(k);
    if(toks.includes(prov)){
      return { key: k, data: provinces[k], matchedBy: "group" };
    }
  }

  return null;
}

/* -------------------- AUTO-FILL DA ARTICOLO -------------------- */

function onArticleChange(){
  const art = selectedArticle();
  if(!art) return;

  // ✅ se l’articolo ha pack.palletType, compila automaticamente PALLET TYPE
  const pt = (art.pack?.palletType || "").trim();
  if(pt && UI.palletType){
    if(!isTouched(UI.palletType)){
      UI.palletType.value = pt;
    }
  }

  // ✅ AUTO-FILL GROUPAGE da rules (es. groupageLm)
  const r = art.rules || {};
  if(UI.service?.value === "GROUPAGE"){
    // ✅ Opzione B: auto-compila i campi GROUPAGE SOLO se l’articolo lo richiede esplicitamente.
    // Evita valori "fantasma" (es. LM=6) su articoli che normalmente viaggiano a Bancale.
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
    out = computeGLS();
  }

  const clientPrice = computeClientPrice(out.cost, markupMode, markupPct);
  if(UI.outClientPrice) UI.outClientPrice.textContent = moneyEUR(clientPrice);

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
    clientPrice,
    markupMode,
    markupPct,

    rules: out.rules || [],
    alerts: out.alerts || [],
    extraNote: UI.extraNote.value || ""
  });

  UI.outText.textContent = summary;
  UI.outCost.textContent = moneyEUR(out.cost);
  if((parseFloat(markupPct)||0) <= 0){
    if(UI.outClientPrice) UI.outClientPrice.textContent = moneyEUR(out.cost);
  }
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

  // Regions
  const regions = DB.palletRates?.meta?.regions || Object.keys(DB.palletRates.rates || {});
  fillSelect(UI.region, regions, { placeholder: "— Seleziona Regione —" });

  // Provinces (UI: usa GEO se presente, altrimenti fallback)
  // Fallback: prova a estrarre token (2 lettere) dalle chiavi groupage
  const provFromGroupageKeys = [];
  const groupKeys = Object.keys(DB.groupageRates?.provinces || {});
  for(const k of groupKeys){
    provFromGroupageKeys.push(...tokenizeProvinceGroupKey(k));
    // se per caso hai anche province singole nel JSON:
    if(/^[A-Z]{2}$/.test(k.toUpperCase().trim())) provFromGroupageKeys.push(normalizeProvince(k));
  }
  const allProvincesFallback = uniq(provFromGroupageKeys);

  // se GEO c'è, la lista province di default la prendiamo dal groupage (fallback) ma poi filtriamo su change regione
  fillSelect(UI.province, allProvincesFallback, { placeholder: "— Seleziona Provincia —" });

  // Pallet types
  const palletTypes =
    DB.palletRates?.meta?.palletTypes ||
    (regions[0] && DB.palletRates?.rates?.[regions[0]] ? Object.keys(DB.palletRates.rates[regions[0]]) : []);
  fillSelect(UI.palletType, palletTypes, { placeholder: "— Seleziona tipo bancale —" });

  // Articles
  renderArticleList("");

  // ✅ touched tracking (manual override)
  if(UI.palletType) UI.palletType.addEventListener("change", () => markTouched(UI.palletType));
  if(UI.lm) UI.lm.addEventListener("input", () => markTouched(UI.lm));
  if(UI.quintali) UI.quintali.addEventListener("input", () => markTouched(UI.quintali));
  if(UI.palletCount) UI.palletCount.addEventListener("input", () => markTouched(UI.palletCount));

  // Events
  UI.service.addEventListener("change", applyServiceUI);
  UI.q.addEventListener("input", () => renderArticleList(UI.q.value));
  UI.article.addEventListener("change", onArticleChange);
  UI.btnCalc.addEventListener("click", onCalc);
  UI.btnCopy.addEventListener("click", onCopy);
  if(UI.markupPct) UI.markupPct.addEventListener("input", onCalc);
  if(UI.markupMode) UI.markupMode.addEventListener("change", onCalc);

  // Filter provinces when region changes
  UI.region.addEventListener("change", () => {
    const regRaw = UI.region.value;
    const reg = regRaw; // GEO potrebbe essere in formato diverso
    const allowed = (GEO && reg && GEO[reg]) ? GEO[reg].map(normalizeProvince) : null;

    if(allowed && allowed.length){
      fillSelect(UI.province, uniq(allowed), { placeholder: "— Seleziona Provincia —" });
    } else {
      fillSelect(UI.province, allProvincesFallback, { placeholder: "— Seleziona Provincia —" });
    }
  });

  UI.province.addEventListener("change", () => {
    const v = normalizeProvince(UI.province.value);
    if(UI.province.value !== v) UI.province.value = v;
  });

  applyServiceUI();
  UI.outText.textContent = "Pronto. Seleziona servizio, destinazione e articolo, poi Calcola.";
  UI.dbgData.textContent = `articoli=${DB.articles.length} | regioni=${regions.length} | province=${(allProvincesFallback||[]).length}`;
}

window.addEventListener("DOMContentLoaded", init);
