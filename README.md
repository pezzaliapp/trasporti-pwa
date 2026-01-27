# Trasporti (PWA) — Calcolo automatico

PWA offline-first per stimare i costi di trasporto:
- Bancale (tariffe max per Regione)
- Groupage / Parziale (tariffe per Provincia con fasce: metri lineari / quintali / n° bancali)
- GLS (opzionale: base per Regione oppure solo “consiglio”)

## Avvio
Apri `index.html` con un web server (consigliato) oppure GitHub Pages.

### GitHub Pages
1. Repo → Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `main` / root
4. Salva → apri URL Pages

## Dati
- `data/articles.json`: elenco articoli + regole da note PDF (forceQuote, suggestGLS, noSponda)
- `data/pallet_rates_by_region.json`: tabella costi per Regione + meta (max plt, preavviso, assicurazione)
- `data/groupage_rates.json`: tariffe groupage per Provincia + fasce

## Regole articoli (note PDF)
Nel JSON articoli puoi impostare:
- `rules.forceQuote: true` (+ reason) → blocca costo, segnala preventivo necessario
- `rules.suggestGLS: true` (+ reason) → suggerisce GLS
- `rules.noSponda: true` → warning consegna senza sponda

## TODO (next)
- Import CSV in batch
- Output TXT/CSV per offerta
- Gestione km oltre 30 / località disagiate (flag + maggiorazioni)
- Prezzi reali GLS (tabella per scaglioni peso/volume)
