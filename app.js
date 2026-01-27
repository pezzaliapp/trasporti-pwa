/* Trasporti PWA — logica base + Batch/Convertitori + GEO + km/disagiata
   - Carica JSON (articoli + tariffe + geo province)
   - Calcolo: PALLET / GROUPAGE / GLS
   - Regole note: forceQuote, suggestGLS, noSponda ecc.
   - Extra: kmOver + località disagiata (warning + eventuale surcharge da meta)
   - Convertitori: CSV articoli -> articles.json | CSV geo -> geo_provinces.json | CSV offerta -> batch_result.csv
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

  // Batch / Convertitori (presenti nel nuovo index.html)
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
  // compatibilità: dataset vecchi usano "SU" -> lo trattiamo come "CI"
  if(x === "SU") return "CI";
  return x;
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
  if(UI.outAlerts) UI.outAlerts.innerHTML = "";
  if(UI.outCost) UI.outCost.textContent = "—";
  if(UI.btnCopy) UI.btnCopy.disabled = true;
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

/* -------------------- CALCOLO -------------------- */

function applyKmAndDisagiata({base, shipments=1, opts, rules, alerts, mode="GROUPAGE"}){
  // warning sempre; surcharge solo se configurato in groupageRates.meta
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
  if(!palletType) return { cost:null, rules:["Manca taglia bancale"], alerts:["Seleziona taglia bancale (MINI/HALF/...)."] };

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

  const maxPerShipment = DB.palletRates?.meta?.maxPalletsPerShipment ?? 5;
  const shipments = Math.ceil(qty / maxPerShipment);
  if(shipments > 1){
    rules.push(`split:${shipments}`);
    alerts.push(`Quantità > ${maxPerShipment}: l'app divide in ${shipments} spedizioni (stima).`);
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

  // km/disagiata
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

  if(art?.rules?.noSponda) alerts.push(`NO SPONDA: attenzione, potrebbe non essere possibile in consegna.`);
  if(art?.rules?.suggestGLS) alerts.push(`Articolo consigliato GLS: ${art.rules.suggestGLSReason || "vedi note"}`);

  // km/disagiata
  base = applyKmAndDisagiata({ base, shipments:1, opts, rules, alerts, mode:"GROUPAGE" });

  return { cost: round2(base), rules, alerts };
}

function computeGLS({region, qty, opts, art}){
  const rules = [];
  const alerts = [];

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

  // km/disagiata (solo warning/surcharge se vuoi; usa stessa meta)
  cost = applyKmAndDisagiata({ base: cost, shipments:1, opts, rules, alerts, mode:"GLS" });

  return { cost: round2(cost), rules, alerts };
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

/* -------------------- CSV HELPERS -------------------- */

function parseCSV(text){
  const rows = [];
  let cur = "", inQ = false;
  const line = [];
  const pushField = () => { line.push(cur); cur = ""; };
  const pushLine = () => { rows.push(line.splice(0)); };

  for(let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];

    if(ch === '"'){
      if(inQ && next === '"'){ cur += '"'; i++; }
      else inQ = !inQ;
      continue;
    }
    if(!inQ && ch === ','){ pushField(); continue; }
    if(!inQ && ch === '\n'){ pushField(); pushLine(); continue; }
    if(ch === '\r') continue;
    cur += ch;
  }
  pushField(); pushLine();
  return rows.filter(r => r.some(c => (c||"").trim().length));
}

function csvToObjects(text){
  const rows = parseCSV(text);
  if(rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, idx) => o[h] = (r[idx] ?? "").trim());
    return o;
  });
}

function toBool(v){
  const t = String(v||"").trim().toLowerCase();
  return (t === "true" || t === "1" || t === "yes" || t === "y");
}

async function readFileText(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsText(file);
  });
}

function downloadFile(filename, content, mime="application/json"){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows){
  const esc = (v) => {
    const s = String(v ?? "");
    if(/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const header = Object.keys(rows[0] || {});
  const lines = [header.join(",")];
  for(const r of rows){
    lines.push(header.map(h => esc(r[h])).join(","));
  }
  return lines.join("\n");
}

/* -------------------- CONVERTITORE ARTICOLI -------------------- */

function convertArticlesCSVtoJSON(objs){
  const out = objs.map(r => {
    const id = r.id || (crypto?.randomUUID ? crypto.randomUUID() : `A_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const palletType = (r.palletType || "").toUpperCase().trim();
    const weightKg = r.weightKg ? Number(r.weightKg) : null;
    const dims = [r.dimXcm, r.dimYcm, r.dimZcm].map(x => x ? Number(x) : null);
    const tags = (r.tags || "").split(/[;|,]/g).map(t => t.trim()).filter(Boolean);

    const rules = {};
    if(toBool(r.forceQuote)) {
      rules.forceQuote = true;
      if(r.forceQuoteReason) rules.forceQuoteReason = r.forceQuoteReason;
    }
    if(toBool(r.suggestGLS)) {
      rules.suggestGLS = true;
      if(r.suggestGLSReason) rules.suggestGLSReason = r.suggestGLSReason;
    }
    if(toBool(r.noSponda)) rules.noSponda = true;

    const pack = { palletType };
    if(weightKg != null) pack.weightKg = weightKg;
    if(dims.some(x => x != null)) pack.dimsCm = dims;

    return {
      id,
      brand: r.brand || "",
      name: r.name || "",
      code: r.code || "",
      pack,
      rules,
      tags
    };
  });

  return out;
}

async function onImportArticlesCSV(){
  const file = UI.fileArticlesCsv?.files?.[0];
  if(!file) return;

  const txt = await readFileText(file);
  const objs = csvToObjects(txt);
  const json = convertArticlesCSVtoJSON(objs);

  MEM.generatedArticlesJSON = json;
  if(UI.btnExportArticles) UI.btnExportArticles.disabled = false;

  if(UI.batchLog){
    UI.batchLog.textContent =
      `Import articoli CSV OK\n` +
      `righe=${objs.length}\n` +
      `articles.json generato=${json.length} record\n\n` +
      `Suggerimento: sostituisci data/articles.json nel repo con questo output.`;
  }
}

function onExportArticlesJSON(){
  if(!MEM.generatedArticlesJSON) return;
  downloadFile("articles.json", JSON.stringify(MEM.generatedArticlesJSON, null, 2), "application/json");
}

/* -------------------- CONVERTITORE GEO -------------------- */

function convertGeoCSVtoJSON(objs){
  const map = {};
  for(const r of objs){
    const region = (r.region || "").trim();
    const prov = normalizeProvince(r.province || "");
    if(!region || !prov) continue;
    if(!map[region]) map[region] = [];
    if(!map[region].includes(prov)) map[region].push(prov);
  }
  for(const k of Object.keys(map)){
    map[k].sort((a,b)=>a.localeCompare(b));
  }
  return map;
}

async function onImportGeoCSV(){
  const file = UI.fileGeoCsv?.files?.[0];
  if(!file) return;

  const txt = await readFileText(file);
  const objs = csvToObjects(txt);
  const geo = convertGeoCSVtoJSON(objs);

  MEM.generatedGeoJSON = geo;
  if(UI.btnExportGeo) UI.btnExportGeo.disabled = false;

  if(UI.batchLog){
    UI.batchLog.textContent =
      `Import geo CSV OK\n` +
      `righe=${objs.length}\n` +
      `regioni=${Object.keys(geo).length}\n\n` +
      `Suggerimento: salva come data/geo_provinces.json nel repo.`;
  }
}

function onExportGeoJSON(){
  if(!MEM.generatedGeoJSON) return;
  downloadFile("geo_provinces.json", JSON.stringify(MEM.generatedGeoJSON, null, 2), "application/json");
}

/* -------------------- BATCH OFFERTA -------------------- */

function findArticleByCode(code){
  const t = (code||"").trim().toLowerCase();
  if(!t) return null;
  return DB.articles.find(a => (a.code||"").trim().toLowerCase() === t) || null;
}

function bestCostForRow(row, opts){
  const art = findArticleByCode(row.code || "");
  const qty = Math.max(1, parseInt(row.qty || "1", 10));
  const region = row.region || "";
  const province = normalizeProvince(row.province || "");
  const service = (row.service || "").toUpperCase().trim();

  const lm = Number(row.lm || 0);
  const quintali = Number(row.quintali || 0);
  const palletCount = Number(row.palletCount || 0);

  let palletType = (row.palletType || "").toUpperCase().trim();
  if(!palletType && UI.batchUseArticlePallet?.checked) palletType = (art?.pack?.palletType || "").toUpperCase();

  const run = (svc) => {
    if(svc === "PALLET") return computePallet({ region, palletType, qty, opts, art });
    if(svc === "GROUPAGE") return computeGroupage({ province, lm, quintali, palletCount, opts, art });
    return computeGLS({ region, qty, opts, art });
  };

  if(service){
    const out = run(service);
    return { service, out, art, qty, region, province, palletType, lm, quintali, palletCount };
  }

  if(!UI.batchPickCheapest?.checked){
    const out = run("PALLET");
    return { service:"PALLET", out, art, qty, region, province, palletType, lm, quintali, palletCount };
  }

  const candidates = [
    {svc:"PALLET", out: run("PALLET")},
    {svc:"GROUPAGE", out: run("GROUPAGE")},
    {svc:"GLS", out: run("GLS")}
  ];

  const valid = candidates.filter(c => c.out?.cost != null);
  if(!valid.length){
    return { service:"PALLET", out: candidates[0].out, art, qty, region, province, palletType, lm, quintali, palletCount };
  }
  valid.sort((a,b)=>a.out.cost - b.out.cost);
  return { service: valid[0].svc, out: valid[0].out, art, qty, region, province, palletType, lm, quintali, palletCount };
}

async function onRunBatch(){
  const file = UI.fileOfferCsv?.files?.[0];
  if(!file) return;

  const txt = await readFileText(file);
  const objs = csvToObjects(txt);
  if(!objs.length){
    if(UI.batchLog) UI.batchLog.textContent = "CSV offerta vuoto o non valido.";
    return;
  }

  const baseOpts = {
    preavviso: !!UI.optPreavviso?.checked,
    assicurazione: !!UI.optAssicurazione?.checked,
    sponda: !!UI.optSponda?.checked
  };

  const outRows = [];
  let ok = 0, ko = 0;

  for(const r of objs){
    const row = {
      code: r.code || r.CODICE || r.articolo || r.Articolo || "",
      qty: r.qty || r.QTY || r.qta || r.QTA || "1",
      service: r.service || r.SERVICE || "",
      region: r.region || r.REGIONE || "",
      province: normalizeProvince(r.province || r.PROVINCIA || ""),
      palletType: r.palletType || r.PALLET || "",
      lm: r.lm || r.LM || "0",
      quintali: r.quintali || r.QUINTALI || "0",
      palletCount: r.palletCount || r.PALLETS || r.BANCALI || "0",
      kmOver: r.kmOver || r.KMOVER || r.km || r.KM || "0",
      disagiata: r.disagiata || r.DISAGIATA || "0"
    };

    const rowOpts = {
      ...baseOpts,
      kmOver: parseInt(row.kmOver || "0", 10) || 0,
      disagiata: (String(row.disagiata||"").trim() === "1" || String(row.disagiata||"").trim().toLowerCase() === "true")
    };

    const res = bestCostForRow(row, rowOpts);
    const cost = res.out?.cost;

    const alerts = (res.out?.alerts || []).join(" | ");
    const rules = (res.out?.rules || []).join(" | ");

    const line = {
      code: row.code,
      qty: row.qty,
      service: res.service,
      region: row.region,
      province: row.province,
      palletType: res.palletType || "",
      lm: row.lm,
      quintali: row.quintali,
      palletCount: row.palletCount,
      kmOver: row.kmOver,
      disagiata: row.disagiata,
      cost_eur: (cost == null) ? "" : cost,
      cost_fmt: moneyEUR(cost),
      article_name: res.art ? `${res.art.brand || ""} ${res.art.name}`.trim() : "",
      flags: alerts,
      rules: rules
    };

    if(cost == null) ko++; else ok++;
    outRows.push(line);
  }

  MEM.batchCSVResult = outRows;
  if(UI.btnExportBatch) UI.btnExportBatch.disabled = false;

  if(UI.batchLog){
    UI.batchLog.textContent =
      `Batch completato\n` +
      `righe input=${objs.length}\n` +
      `righe con costo=${ok}\n` +
      `righe da verificare/preventivo=${ko}\n\n` +
      `Suggerimento: filtra per cost_eur vuoto o flags non vuoto per vedere le eccezioni.`;
  }
}

function onExportBatch(){
  if(!MEM.batchCSVResult || !MEM.batchCSVResult.length) return;
  const csv = toCSV(MEM.batchCSVResult);
  downloadFile("batch_result.csv", csv, "text/csv");
}

/* -------------------- UI ACTIONS -------------------- */

function onCalc(){
  const service = UI.service.value;
  const region = UI.region.value;
  const province = normalizeProvince(UI.province.value);
  const qty = Math.max(1, parseInt(UI.qty.value || "1", 10));
  const palletType = UI.palletType.value;

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

  UI.dbgArticle.textContent = art ? JSON.stringify({id:art.id, code:art.code, rules:art.rules || {}}, null, 0) : "—";

  let out;
  if(service === "PALLET"){
    out = computePallet({ region, palletType, qty, opts, art });
  } else if(service === "GROUPAGE"){
    out = computeGroupage({ province, lm, quintali, palletCount, opts, art });
  } else {
    out = computeGLS({ region, qty, opts, art });
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
    GEO = null; // non obbligatorio
  }

  // Regions
  const regions = DB.palletRates?.meta?.regions || Object.keys(DB.palletRates.rates || {});
  fillSelect(UI.region, regions, { placeholder: "— Seleziona Regione —" });

  // Provinces
  const allProvinces = uniq(Object.keys(DB.groupageRates?.provinces || {}).map(normalizeProvince));
  fillSelect(UI.province, allProvinces, { placeholder: "— Seleziona Provincia —" });

  // Pallet types
  const palletTypes = DB.palletRates?.meta?.palletTypes || ["MINI","QUARTER","HALF","MEDIUM","FULL"];
  fillSelect(UI.palletType, palletTypes, { placeholder: "— Seleziona Taglia —" });

  // Articles
  renderArticleList("");

  // Events
  UI.service.addEventListener("change", applyServiceUI);
  UI.q.addEventListener("input", () => renderArticleList(UI.q.value));
  UI.btnCalc.addEventListener("click", onCalc);
  UI.btnCopy.addEventListener("click", onCopy);

  // Filter provinces when region changes
  UI.region.addEventListener("change", () => {
    const reg = UI.region.value;
    const allowed = (GEO && reg && GEO[reg]) ? GEO[reg].map(normalizeProvince) : null;
    if(allowed && allowed.length){
      fillSelect(UI.province, uniq(allowed), { placeholder: "— Seleziona Provincia —" });
    } else {
      fillSelect(UI.province, allProvinces, { placeholder: "— Seleziona Provincia —" });
    }
  });

  // Normalize province always
  UI.province.addEventListener("change", () => {
    const v = normalizeProvince(UI.province.value);
    if(UI.province.value !== v) UI.province.value = v;
  });

  // Convertitori / Batch
  if(UI.fileArticlesCsv) UI.fileArticlesCsv.addEventListener("change", onImportArticlesCSV);
  if(UI.btnExportArticles) UI.btnExportArticles.addEventListener("click", onExportArticlesJSON);
  if(UI.btnExportArticles) UI.btnExportArticles.disabled = true;

  if(UI.fileGeoCsv) UI.fileGeoCsv.addEventListener("change", onImportGeoCSV);
  if(UI.btnExportGeo) UI.btnExportGeo.addEventListener("click", onExportGeoJSON);
  if(UI.btnExportGeo) UI.btnExportGeo.disabled = true;

  if(UI.fileOfferCsv){
    UI.fileOfferCsv.addEventListener("change", () => {
      const has = !!UI.fileOfferCsv.files?.[0];
      if(UI.btnRunBatch) UI.btnRunBatch.disabled = !has;
    });
  }
  if(UI.btnRunBatch) UI.btnRunBatch.addEventListener("click", onRunBatch);
  if(UI.btnExportBatch) UI.btnExportBatch.addEventListener("click", onExportBatch);
  if(UI.btnRunBatch) UI.btnRunBatch.disabled = true;
  if(UI.btnExportBatch) UI.btnExportBatch.disabled = true;

  applyServiceUI();
  UI.outText.textContent = "Pronto. Seleziona servizio, destinazione e articolo, poi Calcola.";
  UI.dbgData.textContent = `articoli=${DB.articles.length} | regioni=${regions.length} | province=${allProvinces.length}`;
}

window.addEventListener("DOMContentLoaded", init);
