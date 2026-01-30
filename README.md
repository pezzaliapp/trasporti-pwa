# Trasporti — Calcolo automatico (PWA)

PWA offline-first per stimare **costi di trasporto** su base:
- **Bancale (PALLET)**: tariffa max per Regione + tipo bancale
- **Groupage / Parziale (GROUPAGE)**: tariffa per Provincia (o gruppi di province) + scaglioni **LM / Quintali / N° bancali**

Include:
- UI ottimizzata **mobile/desktop**
- **Multi-carico Groupage** (aggiungi più articoli, base + stack)
- Opzioni: **preavviso**, **assicurazione (3%)**, **sponda (se prevista)**, **km oltre capoluogo**, **località disagiata/ZTL/isole minori**
- Pulsanti **Condividi / WhatsApp / TXT**
- Modalità “prezzo cliente” con **Ricarico%** o **Margine%**
- Auto-update PWA (Service Worker) con reload automatico quando esce una nuova versione

---

## Demo / URL
Apri la PWA da GitHub Pages (se pubblicata nel repo) oppure dal tuo dominio.

---

## Struttura progetto
/
├─ index.html
├─ styles.css
├─ app.js
├─ sw.js
├─ manifest.json
└─ data/
├─ articles.json
├─ pallet_rates_by_region.json
├─ groupage_rates.json
└─ geo_provinces.json        (opzionale)
### Dataset richiesti

#### `data/articles.json`
Elenco articoli. Campi tipici supportati:
- `code` (codice)
- `name` (descrizione)
- `palletType` (es. FULL / HALF / ecc.) se applicabile
- `note` / `notes` / `nota` (testo note) usato per le **regole automatiche** (vedi sotto)

> Le note possono contenere indicazioni operative tipo:  
> `NO SPONDA - GROUPAGE 3 MT / quotazione`

#### `data/pallet_rates_by_region.json`
Tariffe bancale per Regione e per tipo bancale.

#### `data/groupage_rates.json`
Tariffe groupage per Provincia o per **gruppi di province** (es. `AR SI LI`, `FR LT`, `BN-NA`, `MT / PZ`).
Supporta scaglioni e logiche “forfait” come da listino Excel.

#### `data/geo_provinces.json` (opzionale)
Mappa Regione → elenco Province per filtrare la select Province in base alla Regione.

---

## Regole automatiche basate sulle NOTE (IMPORTANTI)

La PWA legge le note articolo (campo `note/notes/nota`) e applica direttive:

### 1) `NO SPONDA`
- **Non forza** Groupage da sola
- Disabilita/ignora la spunta **Sponda** (anche se l’utente la attiva)

### 2) `GROUPAGE`
- Forza il servizio **GROUPAGE** (anche se l’utente aveva selezionato PALLET)

### 3) `X MT` (es. `3 MT`, `3,5 MT`)
- Imposta i **metri lineari (LM)** a quel valore
- Applicata solo se **GROUPAGE** è attivo (o viene forzato dalla nota)

### 4) `quotazione` / `preventivo`
- Attiva una nota di controllo (flag interno “forceQuote”)
- Serve a indicare che la tariffa è da considerarsi **indicativa / da confermare**

> Esempio valido:  
> `NO SPONDA - GROUPAGE 3 MT / quotazione`  
> Risultato: servizio GROUPAGE, LM=3, sponda bloccata, warning “quotazione”.

---

## Come si usa

### A) Calcolo singolo
1. Seleziona **Servizio**
2. Seleziona **Regione** e (se GROUPAGE) anche **Provincia**
3. Seleziona **Articolo** e **Quantità**
4. Premi **Calcola**

### B) Multi-carico (solo GROUPAGE)
Quando il servizio è **GROUPAGE**, puoi aggiungere più articoli:
- scegli una **Base (pianale)** e marca gli altri come **stackabili**
- il sistema riporta LM / quintali / bancali totali e calcola su scaglioni

---

## Pulsanti Condivisione

Sotto il box “Riepilogo” ci sono:
- **Condividi** (fallback: copia testo/uso Web Share se disponibile)
- **WhatsApp** (apre WhatsApp con testo pronto)
- **TXT** (scarica un file `.txt` con il report)

Il testo condiviso contiene **solo dati utili** (destinazione, servizio, carico, opzioni e totale), evitando indicazioni “interne”.

---

## Batch / Convertitori

Sezione dedicata a:
- Import CSV articoli → genera `articles.json`
- Import CSV Regioni→Province → genera `geo_provinces.json`
- Import CSV offerta (righe) → calcola trasporto in batch → export `batch_result.csv`

> I template CSV sono indicati nella UI.

---

## PWA / Offline / Auto-update

- La PWA registra `sw.js` per cache offline
- All’avvio forza `reg.update()` (check aggiornamenti)
- Quando un nuovo SW prende il controllo (controllerchange), la pagina fa reload automatico (anti-loop via sessionStorage)

---

## Note e limiti noti (buone pratiche)
- Le tariffe Groupage sono **a scaglioni**: oltre le soglie massime del listino, può servire logica “preventivo”
- Alcune destinazioni (es. isole / ZTL / disagiata) introducono maggiorazioni/avvisi
- Le “note articolo” sono la chiave per forzare comportamenti corretti (es. NO SPONDA / GROUPAGE / X MT)

---

## Licenza
Progetto ad uso interno/didattico (impostare qui la licenza se vuoi pubblicarla).
