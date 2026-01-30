Trasporti PWA — Calcolo automatico costi di trasporto

Progressive Web App (PWA) offline-first per il calcolo dei costi di trasporto (Bancale e Groupage), allineata ai listini reali e alle note di prodotto (smontagomme, ponti, assetti, ecc.).

⸻

🎯 Obiettivo

Fornire uno strumento pratico e affidabile per:
	•	stimare rapidamente il costo di trasporto,
	•	evitare errori commerciali dovuti a interpretazioni errate dei listini,
	•	condividere con il cliente solo le informazioni rilevanti (prezzo finale),
	•	funzionare anche offline.

⸻

🧠 Logica di calcolo (principi chiave)

1) Servizi supportati
	•	Bancale — costo massimo per Regione.
	•	Groupage / Parziale — costo basato su metri lineari (criterio principale).

2) Groupage: criterio corretto

Nel Groupage non si sceglie il costo minimo, ma il vincolo più penalizzante:
	•	il prezzo è determinato dalla fascia dei Metri Lineari (LM);
	•	Quintali e Bancali sono vincoli di validità, non alternative per abbassare il prezzo.

Esempio: 6 m → si applica la colonna 6 m del listino, anche se peso/bancali rientrano in fasce inferiori.

⸻

📝 Regole derivate dalle NOTE di prodotto (fondamentale)

La PWA interpreta automaticamente le NOTE presenti nei dataset (derivati dagli Excel ufficiali).

Regole implementate
	•	GROUPAGE nella nota
	•	forza Servizio = GROUPAGE;
	•	se presente X MT (es. 3 MT, 4 MT) → imposta LM = X;
	•	disabilita il passaggio a Bancale.
	•	NO SPONDA nella nota (da solo)
	•	non forza Groupage;
	•	disattiva solo l’opzione Sponda.
	•	NO SPONDA - GROUPAGE X MT / quotazione
	•	forza GROUPAGE;
	•	imposta LM = X;
	•	disabilita Sponda;
	•	aggiunge nota interna quotazione / preventivo.

Queste regole valgono per Smontagomme, Ponti, Assetti e qualunque articolo futuro che riporti le stesse note.

⸻

📦 Dataset
	•	data/articles.json
	•	anagrafica articoli (codice, descrizione, pallet, note, ecc.)
	•	data/groupage_rates.json
	•	tariffe Groupage per Regione/Provincia
	•	modalità di selezione: MAX (vincolo più penalizzante)
	•	data/pallet_rates_by_region.json
	•	tariffe Bancale per Regione
	•	data/geo_provinces.json
	•	mapping Regione → Province

⚠️ Quando si aggiornano i JSON sotto /data/, è necessario bumpare la cache del Service Worker.

⸻

📲 Condivisione (client-ready)

Sotto il riepilogo sono disponibili:
	•	Condividi (menu nativo iOS/Android via navigator.share, fallback copia);
	•	WhatsApp (testo formattato);
	•	Scarica TXT.

Il testo condiviso:
	•	include solo i dati utili al cliente;
	•	mostra il prezzo finale;
	•	non cita ricarichi, margini o regole interne.

⸻

🔄 Aggiornamenti automatici (PWA)
	•	Service Worker con strategia network-first per index.html e app.js;
	•	aggiornamento automatico al cambio versione (reload controllato);
	•	supporto offline.

⸻

🧩 Tecnologie
	•	Vanilla HTML / CSS / JavaScript
	•	PWA (Service Worker + Cache API)
	•	Compatibile con iOS (Safari / Home Screen), Android e Desktop

⸻

✅ Stato del progetto
	•	Allineato ai listini reali
	•	Regole derivate dalle NOTE (data-driven)
	•	Condivisione pronta per uso commerciale

⸻

📌 Note finali

Questo progetto nasce per ridurre ambiguità operative e velocizzare il lavoro sul campo. Le scelte di design privilegiano coerenza con i listini e semplicità d’uso rispetto a scorciatoie di calcolo.

— PezzaliAPP
