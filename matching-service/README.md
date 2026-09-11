# matching-service (Go) — próxima fase, todavía no implementado

Servicio local que va a recibir `{ title, company, text }` de la extensión
(`POST http://localhost:8787/analyze`) y devolver `{ score, reasoning }`.

Plan:
- Parseo del CV en PDF (una vez, al arrancar el servicio).
- Comparación CV vs. oferta usando la API de Claude con salida JSON estructurada
  (score 0–100 + razonamiento breve).
- Sin persistencia más allá del proceso — no guarda ni loguea el contenido de las
  ofertas ni el CV en disco salvo que se le pida explícitamente.

Mientras este servicio no exista, `extension/src/background.ts` hace `fetch` igual,
falla en silencio (try/catch) y guarda `score: null` con una nota — así el
prototipo de click/scroll se puede calibrar en vivo sin depender de Go todavía.
