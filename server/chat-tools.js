// Tool definitions for Nova Chat (OpenAI/xAI function-calling format).
// Tools are executed in the browser after the user confirms them in the chat.
export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'aufgabe_anlegen',
      description: 'Legt eine Aufgabe (To-do) in Nova an.',
      parameters: {
        type: 'object',
        properties: {
          titel: { type: 'string', description: 'Kurzer Titel der Aufgabe' },
          liste: { type: 'string', description: 'Name der Liste, z. B. "Persönlich" oder "Arbeit" (optional)' },
          faellig_am: { type: 'string', description: 'Fälligkeitsdatum YYYY-MM-DD (optional)' },
          uhrzeit: { type: 'string', description: 'Uhrzeit HH:MM (optional)' },
          erinnern: { type: 'boolean', description: 'Erinnerung per Mitteilung (optional)' },
        },
        required: ['titel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'termin_anlegen',
      description: 'Legt einen Termin im Nova-Kalender an.',
      parameters: {
        type: 'object',
        properties: {
          titel: { type: 'string' },
          datum: { type: 'string', description: 'YYYY-MM-DD' },
          beginn: { type: 'string', description: 'HH:MM (weglassen bei ganztägig)' },
          ende: { type: 'string', description: 'HH:MM (optional)' },
          ganztaegig: { type: 'boolean' },
          ort: { type: 'string' },
          notiz: { type: 'string' },
          erinnerung_minuten: { type: 'integer', description: 'Minuten vorher erinnern, z. B. 10, 60, 1440' },
        },
        required: ['titel', 'datum'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finanzeintrag_erfassen',
      description: 'Erfasst eine Ausgabe oder Einnahme im Finanzplaner. Für Sparen das Wort "Sparen" in die Beschreibung schreiben.',
      parameters: {
        type: 'object',
        properties: {
          betrag: { type: 'number', description: 'Betrag in Euro, positiv' },
          beschreibung: { type: 'string', description: 'z. B. "Essen", "Tanken", "Gehalt"' },
          art: { type: 'string', enum: ['ausgabe', 'einnahme'] },
          datum: { type: 'string', description: 'YYYY-MM-DD (Standard: heute)' },
        },
        required: ['betrag', 'beschreibung'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sparziel_einzahlen',
      description: 'Bucht eine Einzahlung auf ein bestehendes Sparziel.',
      parameters: {
        type: 'object',
        properties: {
          ziel: { type: 'string', description: 'Name des Sparziels (wie in Nova)' },
          betrag: { type: 'number', description: 'Euro' },
        },
        required: ['ziel', 'betrag'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'an_grok_bot_weitergeben',
      description:
        'Gibt eine Aufgabe an Grok Bot (die Grok-App) weiter, z. B. für Recherche, E-Mails, Buchungen oder alles, was Nova selbst nicht kann. Die Antwort kommt in der Grok-App an, nicht im Nova-Chat.',
      parameters: {
        type: 'object',
        properties: {
          aufgabe: { type: 'string', description: 'Klare, vollständige Aufgabe für Grok Bot' },
          bereich: { type: 'string', enum: ['todos', 'kalender', 'finanzen', 'ziele', 'allgemein'] },
          kontext: { type: 'string', description: 'Zusätzliche Details (optional)' },
        },
        required: ['aufgabe'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gewohnheit_anlegen',
      description: 'Legt eine neue Gewohnheit (Angewohnheit) in Nova an, z. B. "Wasser trinken" täglich oder "Sport" 3× pro Woche.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kurzer Name, z. B. "10 Minuten lesen"' },
          emoji: { type: 'string', description: 'Ein passendes Emoji (optional)' },
          haeufigkeit: { type: 'string', enum: ['taeglich', 'wochentage', 'pro_woche'], description: 'taeglich, bestimmte wochentage oder x-mal pro_woche' },
          wochentage: { type: 'array', items: { type: 'string', enum: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] }, description: 'nur bei haeufigkeit=wochentage' },
          mal_pro_woche: { type: 'integer', description: 'nur bei haeufigkeit=pro_woche (1–6)' },
          erinnerung: { type: 'string', description: 'Erinnerungszeit HH:MM (optional)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gewohnheit_abhaken',
      description: 'Markiert eine bestehende Gewohnheit für einen Tag als erledigt (oder nimmt das zurück).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name der Gewohnheit wie in Nova' },
          datum: { type: 'string', description: 'YYYY-MM-DD (Standard: heute)' },
          erledigt: { type: 'boolean', description: 'false, um das Abhaken zurückzunehmen (Standard: true)' },
        },
        required: ['name'],
      },
    },
  },
];

export const TOOL_NAMES = CHAT_TOOLS.map((t) => t.function.name);
