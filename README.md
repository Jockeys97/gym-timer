# Timer Palestra

PWA statica in italiano, senza build né dipendenze nel browser. Tocca un tempo per avviare o riavviare il recupero; usa **Pausa / Riprendi** o **Stop**. Al termine: tre beep, vibrazione se disponibile e schermata «Fatto!», che resta fino al prossimo tocco. Gli ultimi tre secondi hanno un beep breve.

Per provarla: `python3 -m http.server 8000`, poi apri `http://localhost:8000/`. Pubblica tutti i file su HTTPS, anche in un sottopercorso come `/gym-timer/`: i percorsi sono relativi. Su iPhone usa Safari → Condividi → Aggiungi alla schermata Home; sugli altri dispositivi usa l'opzione di installazione del browser.

Dopo la prima apertura completata, il service worker conserva l'app per l'uso offline. Incrementa `CACHE_NAME` in `sw.js` quando aggiorni i file. Audio, vibrazione e schermo sempre acceso dipendono dal browser; in background il sistema può sospendere gli avvisi, ma al ritorno il timer ricalcola il tempo dalla scadenza. Il movimento ridotto disattiva i lampeggi.

Le icone sono già incluse. Per rigenerarle serve Python con Pillow: `python3 scripts/make_icons.py`.
