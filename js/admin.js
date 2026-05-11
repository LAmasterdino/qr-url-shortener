const PATH = "data/redirects.json";

const $ = (id) => document.getElementById(id);

function normalizeCode(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function normalizeUrl(value) {
  return String(value || "").trim();
}

function generateCode(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function base64EncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function base64DecodeUnicode(str) {
  const bin = atob(String(str).replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function showMessage(text, kind = "") {
  const el = $("message");
  if (!el) return;
  el.textContent = text;
  el.className = kind ? `notice ${kind}` : "notice";
}

function getSettings() {
  return {
    owner: $("owner").value.trim(),
    repo: $("repo").value.trim(),
    branch: $("branch").value.trim() || "main",
    token: $("token").value.trim(),
    rememberToken: $("rememberToken").checked,
  };
}

function saveSettings() {
  const { owner, repo, branch, token, rememberToken } = getSettings();
  localStorage.setItem("shortener.owner", owner);
  localStorage.setItem("shortener.repo", repo);
  localStorage.setItem("shortener.branch", branch);
  localStorage.setItem("shortener.rememberToken", String(rememberToken));

  if (rememberToken) {
    localStorage.setItem("shortener.token", token);
  } else {
    localStorage.removeItem("shortener.token");
  }
}

function loadSettings() {
  $("owner").value = localStorage.getItem("shortener.owner") || "";
  $("repo").value = localStorage.getItem("shortener.repo") || "";
  $("branch").value = localStorage.getItem("shortener.branch") || "main";
  $("rememberToken").checked = localStorage.getItem("shortener.rememberToken") === "true";
  $("token").value = $("rememberToken").checked ? (localStorage.getItem("shortener.token") || "") : "";
}

function apiPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function apiBase(owner, repo, path) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${apiPath(path)}`;
}

async function loadRemoteMap() {
  const { owner, repo, branch, token } = getSettings();
  if (!owner || !repo) throw new Error("Bitte Owner und Repo ausfüllen.");

  const response = await fetch(`${apiBase(owner, repo, PATH)}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 404) {
    return { map: {}, sha: null };
  }

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  const content = base64DecodeUnicode(data.content || "e30=");
  const map = content ? JSON.parse(content) : {};
  return { map, sha: data.sha };
}

async function saveRemoteMap(map, sha, commitMessage) {
  const { owner, repo, branch, token } = getSettings();
  if (!owner || !repo) throw new Error("Bitte Owner und Repo ausfüllen.");
  if (!token) throw new Error("Bitte ein GitHub-Token eingeben.");

  const response = await fetch(apiBase(owner, repo, PATH), {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: commitMessage || "Update redirects",
      content: base64EncodeUnicode(JSON.stringify(map, null, 2) + "\n"),
      ...(sha ? { sha } : {}),
      branch,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }

  return text ? JSON.parse(text) : {};
}

async function deleteRemoteEntry(code) {
  const { owner, repo, branch, token } = getSettings();
  if (!token) throw new Error("Bitte ein GitHub-Token eingeben.");

  const metaRes = await fetch(`${apiBase(owner, repo, PATH)}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!metaRes.ok) {
    throw new Error(await metaRes.text());
  }

  const meta = await metaRes.json();
  const current = JSON.parse(base64DecodeUnicode(meta.content || "e30="));
  delete current[code];

  const saveRes = await fetch(apiBase(owner, repo, PATH), {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Delete ${code}`,
      content: base64EncodeUnicode(JSON.stringify(current, null, 2) + "\n"),
      sha: meta.sha,
      branch,
    }),
  });

  if (!saveRes.ok) {
    throw new Error(await saveRes.text());
  }
}

function currentShortUrl(code) {
  if (!code) return "";
  const base = new URL("./", window.location.href).href;
  return `${base}?qrid=${encodeURIComponent(code)}`;
}

function renderQr(shortUrl) {
  const holder = $("qrHolder");
  holder.innerHTML = "";
  if (!shortUrl) return;

  if (window.QRCode) {
    new QRCode(holder, {
      text: shortUrl,
      width: 220,
      height: 220,
      colorDark: "#0b1020",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    holder.innerHTML = `<div class="small muted">QR-Bibliothek lädt nicht. Link:<br><code>${shortUrl}</code></div>`;
  }
}

function fillForm(code, url) {
  $("code").value = code || "";
  $("url").value = url || "";
  const shortUrl = code ? currentShortUrl(code) : "";
  $("shortUrl").value = shortUrl;
  renderQr(shortUrl);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTable(map) {
  const tbody = $("tableBody");
  const entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "de"));

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Noch keine Einträge vorhanden.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([code, url]) => `
    <tr>
      <td><code class="k">${escapeHtml(code)}</code></td>
      <td>${escapeHtml(url)}</td>
      <td>
        <div class="row">
          <button class="button secondary" data-edit="${escapeHtml(code)}">Bearbeiten</button>
          <button class="button secondary" data-copy="${escapeHtml(code)}">Link kopieren</button>
          <button class="button danger" data-del="${escapeHtml(code)}">Löschen</button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-edit");
      fillForm(code, map[code]);
      showMessage(`Eintrag ${code} geladen.`, "ok");
    });
  });

  tbody.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-copy");
      const url = currentShortUrl(code);
      await navigator.clipboard.writeText(url);
      showMessage(`Link kopiert: ${url}`, "ok");
    });
  });

  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-del");
      if (!confirm(`Eintrag "${code}" wirklich löschen?`)) return;

      try {
        showMessage("Lösche Eintrag …");
        await deleteRemoteEntry(code);
        await refresh();
        showMessage(`Eintrag ${code} gelöscht.`, "ok");
      } catch (err) {
        showMessage(String(err.message || err), "err");
      }
    });
  });
}

async function refresh() {
  const { map, sha } = await loadRemoteMap();
  window.__currentSha = sha;
  window.__currentMap = map;
  renderTable(map);

  const code = normalizeCode($("code").value);
  if (code && map[code]) {
    $("url").value = map[code];
    $("shortUrl").value = currentShortUrl(code);
    renderQr(currentShortUrl(code));
  }
}

async function saveCurrent() {
  let code = normalizeCode($("code").value);
  const url = normalizeUrl($("url").value);

  if (!url) {
    throw new Error("Bitte eine Ziel-URL angeben.");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Bitte eine gültige URL mit http:// oder https:// angeben.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Nur http:// oder https:// URLs sind erlaubt.");
  }

  if (!code) {
    code = generateCode(6);
    $("code").value = code;
  }

  const map = { ...(window.__currentMap || {}) };
  map[code] = parsed.toString();

  await saveRemoteMap(map, window.__currentSha, `Update ${code}`);
  return code;
}

function applyQueryPrefill() {
  const params = new URLSearchParams(window.location.search);
  const presetUrl = params.get("changeqr1");
  if (presetUrl && !$("url").value) {
    $("url").value = presetUrl;
  }
}

async function init() {
  loadSettings();
  applyQueryPrefill();

  await refresh().catch((err) => showMessage(String(err.message || err), "err"));

  $("code").addEventListener("input", () => {
    const code = normalizeCode($("code").value);
    $("shortUrl").value = currentShortUrl(code);

    if (code && window.__currentMap?.[code]) {
      $("url").value = window.__currentMap[code];
    }

    renderQr(currentShortUrl(code));
  });

  $("generateCode").addEventListener("click", () => {
    $("code").value = generateCode(6);
    $("code").dispatchEvent(new Event("input"));
    showMessage("Neuer Shortcode erzeugt.", "ok");
  });

  $("copyShortUrl").addEventListener("click", async () => {
    const url = $("shortUrl").value.trim();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    showMessage("Kurzlink kopiert.", "ok");
  });

  $("saveEntry").addEventListener("click", async () => {
    try {
      saveSettings();
      showMessage("Speichere …");
      const code = await saveCurrent();
      await refresh();
      $("shortUrl").value = currentShortUrl(code);
      renderQr(currentShortUrl(code));
      showMessage(`Eintrag gespeichert: ${code}`, "ok");
    } catch (err) {
      showMessage(String(err.message || err), "err");
    }
  });

  $("reload").addEventListener("click", async () => {
    try {
      saveSettings();
      showMessage("Lade Einträge …");
      await refresh();
      showMessage("Aktualisiert.", "ok");
    } catch (err) {
      showMessage(String(err.message || err), "err");
    }
  });

  $("savePrefs").addEventListener("click", async () => {
    saveSettings();
    showMessage("Einstellungen gespeichert.", "ok");
    await refresh().catch((err) => showMessage(String(err.message || err), "err"));
  });

  $("rememberToken").addEventListener("change", saveSettings);

  $("exportJson").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(window.__currentMap || {}, null, 2) + "\n"], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "redirects.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const imported = JSON.parse(text);

    window.__currentMap = imported;
    renderTable(imported);

    const firstCode = Object.keys(imported)[0] || "";
    $("code").value = firstCode;
    $("url").value = imported[firstCode] || "";
    $("shortUrl").value = currentShortUrl(firstCode);
    renderQr(currentShortUrl(firstCode));

    showMessage("JSON importiert. Jetzt speichern, damit es ins Repository geschrieben wird.", "ok");
  });
}

init().catch((err) => showMessage(String(err.message || err), "err"));
