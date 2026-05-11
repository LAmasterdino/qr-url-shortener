const REDIRECTS_PATH = "./data/redirects.json";

function byId(id) {
  return document.getElementById(id);
}

function showError(message, detail = "") {
  const status = byId("status");
  const details = byId("detail");
  const fallback = byId("fallbackLink");

  if (status) status.textContent = message;
  if (details) details.textContent = detail;
  if (fallback) fallback.classList.remove("hidden");
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("qrid") || "").trim();

  if (!code) {
    showError("Kein Shortcode angegeben.", "Nutze ?qrid=DEINCODE oder die kurze Pfad-Variante.");
    return;
  }

  try {
    const res = await fetch(REDIRECTS_PATH, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`redirects.json konnte nicht geladen werden (${res.status}).`);
    }

    const map = await res.json();
    const target = map[code];

    if (!target) {
      showError("Kein Eintrag für diesen Code gefunden.", `Gesuchter Code: ${code}`);
      return;
    }

    const status = byId("status");
    const detail = byId("detail");
    if (status) status.textContent = "Weiterleitung läuft …";
    if (detail) detail.textContent = target;

    window.location.replace(target);
  } catch (err) {
    console.error(err);
    showError("Fehler beim Laden der Weiterleitungen.", String(err.message || err));
  }
}

main();
