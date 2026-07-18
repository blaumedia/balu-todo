import type { TranslationKey } from "./en.js";

// German is first-class (DESIGN §6) — real strings, designed to the longer width.
export const de: Record<TranslationKey, string> = {
  "nav.inbox": "Eingang",
  "nav.today": "Heute",
  "nav.upcoming": "Demnächst",
  "nav.anytime": "Irgendwann",
  "nav.someday": "Vielleicht",
  "nav.logbook": "Logbuch",

  "section.projects": "Projekte",
  "section.thisEvening": "Heute Abend",

  "empty.inbox": "Eingang leer.",
  "empty.today": "Alles erledigt.",
  "empty.upcoming": "Nichts geplant.",
  "empty.anytime": "Nichts wartet.",
  "empty.someday": "Noch keine Ideen.",
  "empty.logbook": "Noch nichts protokolliert.",
  "empty.project": "Hier ist noch nichts.",

  "sync.synced": "Synchron",
  "sync.syncing": "Synchronisiere…",
  "sync.offline": "Offline — lokal gespeichert",
  "sync.error": "Sync fehlgeschlagen",

  "quickadd.placeholder": "Aufgabe hinzufügen — Datum, #Projekt, @Label, !p1",
  "quickadd.hint": "Enter zum Hinzufügen · Esc zum Schließen",
  "quickadd.add": "Hinzufügen",

  "toolbar.search": "Suchen",

  "detail.notes": "Notizen",
  "detail.notesPlaceholder": "Notizen hinzufügen…",
  "detail.startDate": "Startdatum",
  "detail.evening": "Heute Abend",
  "detail.deadline": "Frist",
  "detail.priority": "Priorität",
  "detail.labels": "Labels",
  "detail.project": "Projekt",
  "detail.someday": "Vielleicht",
  "detail.delete": "Aufgabe löschen",
  "detail.recurrence": "Wiederholung",
  "detail.noProject": "Eingang",
  "detail.datePlaceholder": "z. B. morgen, nächsten Di, 31.7.",
  "detail.clear": "Löschen",

  "priority.none": "Keine",
  "priority.p1": "P1",
  "priority.p2": "P2",
  "priority.p3": "P3",

  "settings.title": "Einstellungen",
  "settings.account": "Konto",
  "settings.appearance": "Darstellung",
  "settings.name": "Name",
  "settings.locale": "Sprache",
  "settings.theme": "Design",
  "settings.logout": "Abmelden",
  "settings.save": "Speichern",

  "theme.system": "System",
  "theme.light": "Hell",
  "theme.dark": "Dunkel",

  "auth.loginTitle": "Willkommen zurück",
  "auth.registerTitle": "Konto erstellen",
  "auth.tagline": "die selbst-hostbare To-do-App.",
  "auth.email": "E-Mail",
  "auth.password": "Passwort",
  "auth.name": "Name",
  "auth.login": "Anmelden",
  "auth.register": "Registrieren",
  "auth.toRegister": "Noch kein Konto? Registrieren",
  "auth.toLogin": "Schon ein Konto? Anmelden",
  "auth.errorGeneric": "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  "auth.invalid_credentials": "E-Mail oder Passwort ist falsch.",
  "auth.email_taken": "Diese E-Mail ist bereits registriert.",
  "auth.registration_disabled": "Registrierung ist auf diesem Server deaktiviert.",

  "project.newProject": "Neues Projekt",
  "project.newProjectName": "Projektname",
  "project.addSection": "Abschnitt hinzufügen",
  "project.sectionName": "Abschnittsname",

  "date.today": "Heute",
  "date.tomorrow": "Morgen",
  "date.yesterday": "Gestern",
  "date.overdue": "Überfällig",

  "common.cancel": "Abbrechen",
  "common.later": "Später diese Woche",
};
