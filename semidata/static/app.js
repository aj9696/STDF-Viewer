/* SemiData local workbench. No external runtime or assets. */
import { esc, fmt, precise, date } from "./format.js";
import { histogramChart, meansChart, pointsChart } from "./charts.js";
const $ = (id) => document.getElementById(id);
const s = {
  token: "",
  datasets: [],
  runs: [],
  selected: new Set(),
  tests: [],
  test: "",
  view: "library",
  preview: null,
  previewKey: "",
  testsRevision: 0,
  analysisRevision: 0,
  busyImport: false,
};
const names = {
  library: "Data library",
  explore: "Explore",
  pat: "PAT lab",
  runs: "Saved runs",
  help: "Engineer guide",
};
const empty = (title, detail) =>
  /* HTML */ `<div class="empty">
    <h2>${esc(title)}</h2>
    <p>${esc(detail)}</p>
  </div>`;
const warnings = (items) =>
  items?.length
    ? /* HTML */ `<div class="warnings" role="status">
        ${items.map((v) => /* HTML */ `<p>${esc(v)}</p>`).join("")}
      </div>`
    : "";
const metric = (label, value, detail = "", unit = "", accent = false) =>
  /* HTML */ `<div class="metric${accent ? " accent" : ""}">
    <div class="metric-label">${esc(label)}</div>
    <div class="metric-value">
      ${esc(value)}${unit ? /* HTML */ `<small>${esc(unit)}</small>` : ""}
    </div>
    <div class="metric-detail">${esc(detail)}</div>
  </div>`;

function notice(message, kind = "") {
  const node = $("notice");
  node.textContent = message;
  node.className = `notice ${kind}`;
  node.hidden = !message;
}
async function api(path, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SemiData-Token": s.token,
          },
          body: JSON.stringify(body),
        };
  const response = await fetch(`/api${path}`, options);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The server returned an unreadable response (${response.status}). Check the application terminal.`,
    );
  }
  if (!response.ok)
    throw new Error(
      data.error?.message || `Request failed (${response.status}).`,
    );
  return data;
}
async function action(message, work, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  notice(message, "busy");
  try {
    await work();
  } catch (error) {
    notice(error.message || "The operation could not finish.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}
function selection() {
  return {
    dataset_ids: [...s.selected],
    test_key: s.test,
    site: $("site-select").value === "" ? null : Number($("site-select").value),
    attempts: $("attempts-select").value,
  };
}
function invalidatePreview() {
  if (s.preview)
    $("pat-output").innerHTML = empty(
      "The population or recipe changed",
      "Preview again to evaluate these settings before saving.",
    );
  s.preview = null;
  s.previewKey = "";
  $("save-run").disabled = true;
}
async function loadState(initial = false) {
  const data = await api("/state");
  s.token = data.token;
  s.datasets = data.datasets;
  s.runs = data.runs;
  s.selected = new Set(
    [...s.selected].filter((id) => s.datasets.some((d) => d.id === id)),
  );
  if (initial && !s.selected.size)
    s.datasets.slice(0, 20).forEach((d) => s.selected.add(d.id));
  $("version").textContent = `Workbench ${data.version}`;
  $("workspace-path").textContent = `Workspace: ${data.workspace}`;
  renderLibrary();
  renderRuns();
  renderReferences();
}
function filteredDatasets() {
  const q = $("library-search").value.trim().toLowerCase();
  return s.datasets.filter((d) =>
    [d.name, d.lot, d.product].some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(q),
    ),
  );
}
function datasetStatus(dataset) {
  return dataset.warnings?.length
    ? /* HTML */ `<details class="source-warnings">
        <summary>${dataset.warnings.length} warnings</summary>
        <div>
          ${dataset.warnings
            .map((message) => /* HTML */ `<p>${esc(message)}</p>`)
            .join("")}
        </div>
      </details>`
    : '<span class="tag teal">Ready</span>';
}
function renderLibrary() {
  const total = (key) =>
    s.datasets.reduce((n, d) => n + (Number(d[key]) || 0), 0);
  $("nav-count").textContent = s.datasets.length;
  $("dataset-count").textContent = s.datasets.length;
  $("library-metrics").innerHTML =
    metric(
      "Datasets",
      fmt(s.datasets.length),
      "Persistent, deduplicated sources",
      "",
      true,
    ) +
    metric(
      "Device attempts",
      fmt(total("dut_count")),
      "Source records · before selection",
    ) +
    metric(
      "Scalar measurements",
      fmt(total("measurements")),
      "PTR data available for analysis",
    ) +
    metric(
      "Products",
      fmt(new Set(s.datasets.map((d) => d.product).filter(Boolean)).size),
      `${new Set(s.datasets.map((d) => d.lot).filter(Boolean)).size} recorded lots`,
    );
  $("selection-count").textContent =
    `${s.selected.size} dataset${s.selected.size === 1 ? "" : "s"} selected`;
  $("open-explore").disabled = !s.selected.size;
  if (!s.datasets.length) {
    $("dataset-table").innerHTML = empty(
      "A fresh workspace. A new perspective.",
      "Load example data above for a guided first look, or import a local STDF file to start your library.",
    );
    return;
  }
  const datasets = filteredDatasets();
  if (!datasets.length) {
    $("dataset-table").innerHTML = empty(
      "No matching datasets",
      "Try a different file name, lot, or product.",
    );
    return;
  }
  $("dataset-table").innerHTML = /* HTML */ `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th><span class="sr-only">Select dataset</span></th>
          <th>Dataset / imported</th>
          <th>Product</th>
          <th>Lot</th>
          <th class="numeric">Devices</th>
          <th class="numeric">Measurements</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${datasets
          .map(
            (d) =>
              /* HTML */ `<tr class="${s.selected.has(d.id) ? "selected" : ""}">
                <td>
                  <input
                    type="checkbox"
                    class="dataset-check"
                    data-id="${esc(d.id)}"
                    aria-label="Select ${esc(d.name)}"
                    ${s.selected.has(d.id) ? "checked" : ""}
                  />
                </td>
                <td class="file-name">
                  ${esc(d.name)}<span class="file-detail"
                    >${esc(date(d.imported_at))}</span
                  >
                </td>
                <td>${esc(d.product || "—")}</td>
                <td>
                  <span class="tag">${esc(d.lot || "Not recorded")}</span>
                </td>
                <td class="numeric">${fmt(d.dut_count)}</td>
                <td class="numeric">${fmt(d.measurements)}</td>
                <td>${datasetStatus(d)}</td>
              </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}
function renderReferences() {
  const previous = new Set(
    [...$("reference-select").selectedOptions].map((o) => o.value),
  );
  $("reference-select").innerHTML = s.datasets
    .map(
      (d) =>
        /* HTML */ `<option
          value="${esc(d.id)}"
          ${previous.has(d.id) ? "selected" : ""}
        >
          ${esc(d.lot || "No lot")} · ${esc(d.name)}
        </option>`,
    )
    .join("");
}
function renderTestOptions() {
  const q = $("test-search").value.trim().toLowerCase();
  const visible = s.tests.filter((t) =>
    `${t.number} ${t.name} ${t.unit}`.toLowerCase().includes(q),
  );
  if (!visible.some((t) => t.key === s.test)) s.test = visible[0]?.key || "";
  $("test-select").innerHTML = visible.length
    ? visible
        .map(
          (t) =>
            /* HTML */ `<option
              value="${esc(t.key)}"
              ${t.key === s.test ? "selected" : ""}
            >
              ${esc(t.number)} ·
              ${esc(t.name)}${t.unit ? ` [${esc(t.unit)}]` : ""}
            </option>`,
        )
        .join("")
    : /* HTML */ `<option value="">
        ${s.selected.size
          ? "No matching scalar tests"
          : "Select datasets in the library"}
      </option>`;
}
async function refreshTests() {
  const revision = ++s.testsRevision;
  ++s.analysisRevision;
  invalidatePreview();
  const selected = s.datasets.filter((d) => s.selected.has(d.id));
  $("population-summary").textContent = selected.length
    ? `${selected.length} dataset${selected.length === 1 ? "" : "s"} · ${selected.map((d) => d.lot || d.name).join(" · ")}`
    : "Select datasets in the data library.";
  s.tests = [];
  $("test-select").innerHTML = '<option value="">Loading tests…</option>';
  let data = { tests: [], sites: [] };
  try {
    if (s.selected.size)
      data = await api(
        `/tests?datasets=${encodeURIComponent([...s.selected].join(","))}`,
      );
  } catch (error) {
    if (revision === s.testsRevision) {
      notice(error.message, "error");
      $("test-select").innerHTML =
        '<option value="">Could not load tests</option>';
    }
    return;
  }
  if (revision !== s.testsRevision) return;
  s.tests = data.tests;
  renderTestOptions();
  const site = $("site-select").value;
  $("site-select").innerHTML =
    '<option value="">All sites</option>' +
    data.sites
      .map(
        (n) => /* HTML */ `<option value="${esc(n)}">Site ${esc(n)}</option>`,
      )
      .join("");
  if (data.sites.some((n) => String(n) === site)) $("site-select").value = site;
  if (s.view === "explore") await analyze();
}
function showView(view) {
  if (!names[view]) view = "library";
  if (s.view !== view) notice("");
  s.view = view;
  document
    .querySelectorAll(".view")
    .forEach((node) => (node.hidden = node.id !== `view-${view}`));
  document.querySelectorAll("[data-view]").forEach((node) => {
    node.classList.toggle("active", node.dataset.view === view);
    node.setAttribute(
      "aria-current",
      node.dataset.view === view ? "page" : "false",
    );
  });
  $("population-controls").hidden = !["explore", "pat"].includes(view);
  $("view-label").textContent = names[view];
  history.replaceState(null, "", `#${view}`);
  if (view === "explore") analyze();
}

function renderAnalysis(data) {
  const st = data.stats,
    unit = data.test.unit || "",
    pop = data.population;
  const groups = /* HTML */ `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Dataset / lot</th>
          <th class="numeric">N</th>
          <th class="numeric">Mean</th>
          <th class="numeric">Sample SD</th>
          <th class="numeric">Min</th>
          <th class="numeric">Max</th>
          <th class="numeric">Cpk</th>
        </tr>
      </thead>
      <tbody>
        ${data.groups
          .map(
            (g, i) =>
              /* HTML */ `<tr>
                <td class="file-name">
                  ${i + 1}. ${esc(g.lot || "No lot")}<span class="file-detail"
                    >${esc(g.name)}</span
                  >
                </td>
                ${[g.count, g.mean, g.stdev, g.min, g.max, g.cpk]
                  .map(
                    (n) =>
                      /* HTML */ `<td class="numeric">${esc(precise(n))}</td>`,
                  )
                  .join("")}
              </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
  $("analysis-output").innerHTML =
    warnings(data.warnings) +
    /* HTML */ `<p class="summary-line">
        <strong>${esc(data.test.number)} · ${esc(data.test.name)}</strong> ·
        ${fmt(pop.valid)} valid of ${fmt(pop.total)} measurements ·
        ${fmt(pop.excluded)} excluded · passing and failing devices included
      </p>
      <div class="metrics">
        ${metric(
          "Population mean",
          precise(st.mean),
          "Arithmetic mean",
          unit,
          true,
        )}${metric(
          "Sample deviation",
          precise(st.stdev),
          "Sample standard deviation",
          unit,
        )}${metric(
          "Cpk estimate",
          precise(st.cpk),
          `LSL ${precise(st.lsl)} · USL ${precise(st.usl)}`,
        )}${metric(
          "Valid measurements",
          fmt(st.count),
          "Full selected population",
        )}
      </div>
      <div class="charts-grid">
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>Measurement distribution</h2>
              <p>Full population · ${fmt(st.count)} valid values</p>
            </div>
            <span class="badge">All data</span>
          </div>
          <div class="chart">${histogramChart(data.histogram, unit)}</div>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>Compare lot means</h2>
              <p>One point per source dataset · hover for details</p>
            </div>
          </div>
          <div class="chart">${meansChart(data.groups, unit)}</div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Ordered measurements</h2>
            <p>Source order, not elapsed time · hover for device details</p>
          </div>
          <span class="badge"
            >${data.points_sampled ? "Sampled" : "All points"}</span
          >
        </div>
        <div class="chart">${pointsChart(data.points, st, unit)}</div>
        <p class="chart-caption">
          ${fmt(data.points.length)} plotted points from
          ${fmt(data.points_total)} valid measurements. Statistics and histogram
          use the full valid population.
        </p>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Dataset statistics</h2>
            <p>
              ${esc(
                unit
                  ? `Measurement unit: ${unit}`
                  : "No measurement unit recorded",
              )}
              · capability is unavailable when consistent limits or spread are
              missing.
            </p>
          </div>
        </div>
        ${groups}
      </section>`;
}
async function analyze() {
  const revision = ++s.analysisRevision;
  if (!s.selected.size || !s.test) {
    $("refresh-analysis").disabled = true;
    $("analysis-output").innerHTML = empty(
      "Choose your analysis population",
      "Select datasets in the library, then choose a scalar measurement above.",
    );
    return;
  }
  $("refresh-analysis").disabled = true;
  $("analysis-output").innerHTML = empty(
    "Analyzing measurements…",
    "Reading the full selected population from your local workspace.",
  );
  try {
    const result = await api("/analysis", selection());
    if (revision === s.analysisRevision) renderAnalysis(result);
  } catch (error) {
    if (revision === s.analysisRevision) {
      $("analysis-output").innerHTML = empty(
        "Analysis could not complete",
        error.message,
      );
      notice(error.message, "error");
    }
  } finally {
    if (revision === s.analysisRevision) $("refresh-analysis").disabled = false;
  }
}

function recipe() {
  return {
    selection: selection(),
    reference_ids: [...$("reference-select").selectedOptions].map(
      (o) => o.value,
    ),
    method: $("pat-method").value,
    k: Number($("pat-k").value),
    name: $("recipe-name").value.trim() || "Population screening",
  };
}
function renderScreening(result, target) {
  const unit = result.unit || "",
    r = result.recipe || {};
  let test = [];
  try {
    test = JSON.parse(r.selection?.test_key || "[]");
  } catch {
    /* Older results may omit test identity. */
  }
  const testLabel = test.length
    ? `${test[0]} · ${test[1]}${test[2] ? ` [${test[2]}]` : ""}`
    : "Measurement identity unavailable";
  const flagged = result.flagged || [];
  const rows = flagged.length
    ? /* HTML */ `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source / part</th>
              <th class="numeric">DUT index</th>
              <th class="numeric">Site / head</th>
              <th>Wafer</th>
              <th class="numeric">X / Y</th>
              <th class="numeric">Value${unit ? ` (${esc(unit)})` : ""}</th>
            </tr>
          </thead>
          <tbody>
            ${flagged
              .map(
                (f) =>
                  /* HTML */ `<tr>
                    <td class="file-name">
                      ${esc(f.part_id || "No part ID")}<span class="file-detail"
                        >${esc(f.dataset)}</span
                      >
                    </td>
                    <td class="numeric">${fmt(f.dut_index, 0)}</td>
                    <td class="numeric">
                      ${esc(f.site ?? "—")} / ${esc(f.head ?? "—")}
                    </td>
                    <td>${esc(f.wafer ?? "—")}</td>
                    <td class="numeric">
                      ${esc(f.x ?? "—")} / ${esc(f.y ?? "—")}
                    </td>
                    <td class="numeric">${esc(precise(f.value))}</td>
                  </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : empty(
        "No devices flagged",
        "No eligible measurements fall outside this recipe’s statistical limits.",
      );
  const sourceRole = (id) =>
    [
      r.selection?.dataset_ids?.includes(id) ? "evaluation" : "",
      r.reference_ids?.includes(id) ? "reference" : "",
    ]
      .filter(Boolean)
      .join(" + ");
  const recipeText = `${r.method === "mad" ? "Median / scaled MAD" : r.method === "sigma" ? "Mean / sample SD" : "Statistical screening"} · k = ${r.k ?? "—"} · ${r.selection?.attempts === "all" ? "all attempts" : "current attempts within each file"} · ${r.selection?.site == null ? "all sites" : `site ${r.selection.site}`}`;
  $(target).innerHTML =
    warnings(result.warnings) +
    /* HTML */ `<div class="metrics pat-summary">
        ${metric(
          "Reference population",
          fmt(result.reference_count),
          "Eligible measurements for limits",
          "",
          true,
        )}${metric(
          "Evaluated population",
          fmt(result.evaluated_count),
          `${fmt(result.excluded_count)} target measurements excluded`,
        )}${metric(
          "Flagged measurements",
          fmt(result.flagged_count),
          "Outside the calculated limits",
        )}${metric(
          "Flagged fraction",
          fmt(result.flagged_percent, 2),
          "Of evaluated eligible measurements",
          "%",
        )}
      </div>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>
              ${result.id ? "Saved screening result" : "Screening preview"}
            </h2>
            <p><strong>${esc(testLabel)}</strong> · ${esc(recipeText)}</p>
          </div>
          ${result.id
            ? /* HTML */ `<a
                class="button compact secondary"
                href="/api/runs/${encodeURIComponent(result.id)}/csv"
                >Download flags CSV ↓</a
              >`
            : '<span class="badge">Not yet saved</span>'}
        </div>
        <div class="limit-strip">
          <div>
            <small>Lower screening limit</small
            ><strong>${esc(precise(result.lower))} ${esc(unit)}</strong>
          </div>
          <div>
            <small>Population center</small
            ><strong>${esc(precise(result.center))} ${esc(unit)}</strong>
          </div>
          <div>
            <small>Upper screening limit</small
            ><strong>${esc(precise(result.upper))} ${esc(unit)}</strong>
          </div>
          <div>
            <small>Reference spread</small
            ><strong>${esc(precise(result.spread))} ${esc(unit)}</strong>
          </div>
        </div>
        <div class="panel-heading">
          <div>
            <h2>Flagged measurements</h2>
            <p>
              ${fmt(flagged.length)} shown of
              ${fmt(result.flagged_count)}${result.flagged_truncated
                ? " · preview is limited; save and export the full CSV"
                : ""}
              · limits do not modify original pass/fail records
            </p>
          </div>
        </div>
        ${rows}
        <div class="pat-provenance">
          <strong>${esc(result.name)}</strong> · calculation engine
          ${esc(result.engine_version)}${result.created_at
            ? ` · saved ${esc(date(result.created_at))}`
            : ""}
          <details>
            <summary>
              Source provenance · ${result.sources?.length || 0} datasets
            </summary>
            ${(result.sources || [])
              .map(
                (d) =>
                  /* HTML */ `<p>
                    <strong>${esc(d.name)}</strong> · lot
                    ${esc(d.lot || "not recorded")} ·
                    ${esc(sourceRole(d.id))}<br />SHA-256:
                    <code>${esc(d.sha256)}</code>
                  </p>`,
              )
              .join("")}
          </details>
        </div>
      </section>`;
}
function renderRuns() {
  if (!s.runs.length) {
    $("runs-list").innerHTML = empty(
      "Experiments worth keeping",
      "Preview a recipe in PAT lab, then save the experiment to preserve its inputs, limits, and flagged devices.",
    );
    return;
  }
  $("runs-list").innerHTML = /* HTML */ `<div class="panel-heading">
      <div>
        <h2>
          Screening history <span class="count-tag">${s.runs.length}</span>
        </h2>
        <p>Each saved run preserves the result at the time of evaluation.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Experiment</th>
            <th>Saved</th>
            <th>Method</th>
            <th class="numeric">Evaluated</th>
            <th class="numeric">Flagged</th>
            <th>Export</th>
          </tr>
        </thead>
        <tbody>
          ${s.runs
            .map(
              (r) =>
                /* HTML */ `<tr class="run-row">
                  <td>
                    <button class="text-button" data-run="${esc(r.id)}">
                      ${esc(r.name)} →
                    </button>
                  </td>
                  <td>${esc(date(r.created_at))}</td>
                  <td>
                    <span class="tag"
                      >${esc(
                        r.method === "mad" ? "Median / MAD" : "Mean / SD",
                      )}</span
                    >
                  </td>
                  <td class="numeric">${fmt(r.evaluated_count)}</td>
                  <td class="numeric">${fmt(r.flagged_count)}</td>
                  <td>
                    <a
                      href="/api/runs/${encodeURIComponent(r.id)}/csv"
                      aria-label="Download flags CSV for ${esc(r.name)}"
                      >CSV ↓</a
                    >
                  </td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}
async function importFiles(isDemo = false) {
  if (s.busyImport) return;
  const paths = $("import-paths")
    .value.split(/\r?\n/)
    .map((v) => v.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  if (!isDemo && !paths.length) return;
  s.busyImport = true;
  $("import-btn").disabled = true;
  $("demo-btn").disabled = true;
  let count = 0,
    duplicates = 0;
  try {
    if (isDemo) {
      notice("Loading the bundled evaluation datasets…", "busy");
      const data = await api("/demo", {});
      s.selected = new Set(data.datasets.slice(0, 20).map((d) => d.id));
      count = data.datasets.length;
    } else
      for (let i = 0; i < paths.length; i++) {
        const message = `Importing file ${i + 1} of ${paths.length}. Large files may take a while…`;
        notice(message, "busy");
        $("import-status").textContent = message;
        const data = await api("/imports", { path: paths[i] });
        count++;
        if (data.duplicate) duplicates++;
        if (s.selected.size < 20) s.selected.add(data.dataset.id);
      }
    await loadState();
    await refreshTests();
    if (!isDemo) $("import-paths").value = "";
    notice(
      isDemo
        ? "Example data is ready. Explore a measurement or open PAT lab to try a screening recipe."
        : `${count} file${count === 1 ? "" : "s"} processed${duplicates ? ` · ${duplicates} already in the library` : ""}. Your workspace is ready.`,
    );
  } catch (error) {
    try {
      await loadState();
      await refreshTests();
    } catch {
      /* Keep the original actionable import error. */
    }
    notice(
      `${count ? `${count} file(s) completed before this error. ` : ""}${error.message}`,
      "error",
    );
  } finally {
    s.busyImport = false;
    $("import-btn").disabled = false;
    $("demo-btn").disabled = false;
    $("import-status").textContent = "STDF and supported compressed STDF files";
  }
}

document
  .querySelectorAll("[data-view]")
  .forEach((node) =>
    node.addEventListener("click", () => showView(node.dataset.view)),
  );
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  showView("library");
});
$("change-datasets").addEventListener("click", () => showView("library"));
$("open-explore").addEventListener("click", () => showView("explore"));
$("library-search").addEventListener("input", renderLibrary);
$("dataset-table").addEventListener("change", async (event) => {
  const input = event.target;
  if (!input.matches(".dataset-check")) return;
  if (input.checked && s.selected.size >= 20) {
    input.checked = false;
    notice(
      "Select up to 20 datasets for one analysis. Clear a selection to add another.",
      "error",
    );
    return;
  }
  if (input.checked) s.selected.add(input.dataset.id);
  else s.selected.delete(input.dataset.id);
  renderLibrary();
  await refreshTests();
});
$("clear-selection").addEventListener("click", async () => {
  s.selected.clear();
  renderLibrary();
  await refreshTests();
});
$("select-visible").addEventListener("click", async () => {
  const datasets = filteredDatasets();
  for (const d of datasets) {
    if (s.selected.size >= 20) break;
    s.selected.add(d.id);
  }
  renderLibrary();
  await refreshTests();
  if (datasets.some((d) => !s.selected.has(d.id)))
    notice(
      "Selected up to the 20-dataset analysis limit. Narrow your search to choose a smaller population.",
    );
});
$("import-form").addEventListener("submit", (event) => {
  event.preventDefault();
  importFiles();
});
$("demo-btn").addEventListener("click", () => importFiles(true));
let searchTimer;
$("test-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const previous = s.test;
    renderTestOptions();
    if (previous !== s.test) {
      invalidatePreview();
      if (s.view === "explore") analyze();
    }
  }, 200);
});
$("test-select").addEventListener("change", () => {
  s.test = $("test-select").value;
  invalidatePreview();
  if (s.view === "explore") analyze();
});
["site-select", "attempts-select"].forEach((id) =>
  $(id).addEventListener("change", () => {
    invalidatePreview();
    if (s.view === "explore") analyze();
  }),
);
["recipe-name", "pat-method", "pat-k", "reference-select"].forEach((id) =>
  $(id).addEventListener("input", invalidatePreview),
);
$("clear-reference").addEventListener("click", () => {
  [...$("reference-select").options].forEach((o) => (o.selected = false));
  invalidatePreview();
});
$("refresh-analysis").addEventListener("click", analyze);
$("pat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!s.selected.size || !s.test) {
    notice(
      "Choose datasets and a measurement before previewing a screening recipe.",
      "error",
    );
    return;
  }
  const body = recipe(),
    key = JSON.stringify(body);
  invalidatePreview();
  await action(
    "Evaluating the reference and target populations…",
    async () => {
      const result = await api("/pat/preview", body);
      if (key !== JSON.stringify(recipe())) {
        notice(
          "The recipe changed while calculating. Preview again to evaluate your current settings.",
        );
        return;
      }
      s.preview = result;
      s.previewKey = key;
      renderScreening(result, "pat-output");
      $("save-run").disabled = false;
      notice(
        `Preview ready: ${fmt(result.flagged_count)} of ${fmt(result.evaluated_count)} eligible measurements flagged. Review the result before saving.`,
      );
    },
    $("preview-btn"),
  );
});
$("save-run").addEventListener("click", async () => {
  const button = $("save-run"),
    body = recipe();
  if (button.disabled || !s.preview || JSON.stringify(body) !== s.previewKey)
    return;
  button.disabled = true;
  $("preview-btn").disabled = true;
  const locked = [
    ...document.querySelectorAll("button,input,select,textarea"),
  ].map((node) => [node, node.disabled]);
  locked.forEach(([node]) => (node.disabled = true));
  notice("Saving your screening experiment and its source provenance…", "busy");
  let saved = false;
  try {
    const result = await api("/runs", body);
    saved = true;
    renderScreening(result, "pat-output");
    try {
      await loadState();
      notice(
        `“${result.name}” is saved. Reopen it from Saved runs or export the flagged-device CSV.`,
      );
    } catch (error) {
      notice(
        `“${result.name}” was saved, but the history could not refresh: ${error.message} Use Refresh history in Saved runs.`,
        "error",
      );
    }
  } catch (error) {
    notice(error.message, "error");
  } finally {
    locked.forEach(([node, disabled]) => (node.disabled = disabled));
    $("preview-btn").disabled = false;
    button.disabled = saved;
  }
});
$("refresh-runs").addEventListener("click", () =>
  action(
    "Refreshing experiment history…",
    async () => {
      await loadState();
      notice("Experiment history is up to date.");
    },
    $("refresh-runs"),
  ),
);
let runRevision = 0;
$("runs-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-run]");
  if (!button) return;
  const revision = ++runRevision;
  await action(
    "Loading the saved screening result…",
    async () => {
      const result = await api(
        `/runs/${encodeURIComponent(button.dataset.run)}`,
      );
      if (revision !== runRevision) return;
      renderScreening(result, "run-output");
      notice(`Loaded “${result.name}” · saved ${date(result.created_at)}.`);
    },
    button,
  );
});
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
(async () => {
  $("import-btn").disabled = true;
  $("demo-btn").disabled = true;
  notice("Opening your local workspace…", "busy");
  try {
    await loadState(true);
    await refreshTests();
    showView(location.hash.slice(1) || "library");
    notice("");
    $("import-btn").disabled = false;
    $("demo-btn").disabled = false;
  } catch (error) {
    notice(
      `Could not connect to the local workspace: ${error.message} Make sure the application is running, then reload this page.`,
      "error",
    );
  }
})();
