import { tr } from './viewer-i18n.js';
import { boundedInteger, invalid, parseTestKey, validateSelection } from './viewer-model.js';
import { previewScreening } from './viewer-screening.js';
import { sourceProvenance } from './viewer-population.js';
import { element } from './library-home-view.js';
import { button, table, detail, warnings, selectField, testTitle } from './viewer-view.js';

const FORMAT = 'semidata-pat-lot-recipes', VERSION = 1;
const idsFor = selection => [...new Set(selection.groups.flatMap(group => group.datasetIds))];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const label = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) invalid('Lot names and recipe IDs require 1–120 characters.');
  return value.trim();
};

/** Membership is an explicit assignment, independent of MIR names. */
export function validatePatLotPlan(inputSelection, lots) {
  const selection = validateSelection(inputSelection), selectedIds = idsFor(selection), assigned = new Set(), lotIds = new Set();
  if (!Array.isArray(lots) || !lots.length || lots.length > 8) invalid('Choose one to eight lot recipes.');
  return lots.map(lot => {
    const id = label(lot?.id), name = label(lot.name);
    if (lotIds.has(id)) invalid('Lot recipe IDs must be distinct.'); lotIds.add(id);
    if (!Array.isArray(lot.datasetIds) || !lot.datasetIds.length || lot.datasetIds.length > 8) invalid('Assign at least one selected source to every lot.');
    for (const source of lot.datasetIds) {
      if (!selectedIds.includes(source)) invalid('A lot names a source outside the selected comparison.');
      if (assigned.has(source)) invalid('A source may belong to only one PAT lot.'); assigned.add(source);
    }
    const fit = lot.fit ?? 'sigma', k = lot.k ?? 3;
    if (!['sigma', 'mad'].includes(fit) || !Number.isFinite(k) || k < 0.5 || k > 10) invalid('PAT requires sigma/MAD and a multiplier from 0.5 to 10.');
    const failBin = boundedInteger(lot.failBin ?? 8, 0, 65534, 'Lot failure bin');
    if (!Array.isArray(lot.recipes) || !lot.recipes.length || lot.recipes.length > 12) invalid('Each lot needs one to twelve numeric test recipes.');
    const keys = new Set(), recipes = lot.recipes.map(recipe => {
      if (parseTestKey(recipe?.testKey).family === 20 || keys.has(recipe.testKey)) invalid('Lot recipes require distinct numeric tests.'); keys.add(recipe.testKey);
      const low = recipe.low ?? null, high = recipe.high ?? null;
      if ([low, high].some(value => value !== null && !Number.isFinite(value)) || low !== null && high !== null && low > high) invalid('Lot test limits must be finite and ordered.');
      return { testKey: recipe.testKey, low, high, failBin: recipe.failBin == null ? null : boundedInteger(recipe.failBin, 0, 65534, 'Test failure bin') };
    });
    let referenceGroups = null;
    if (lot.referenceGroups != null) {
      if (!Array.isArray(lot.referenceGroups) || !lot.referenceGroups.length || new Set(lot.referenceGroups).size !== lot.referenceGroups.length) invalid('Choose distinct reference groups.');
      referenceGroups = lot.referenceGroups.map(group => boundedInteger(group, 0, selection.groups.length - 1, 'Reference group'));
      const references = new Set();
      for (const group of referenceGroups) {
        const members = selection.groups[group].datasetIds.filter(source => lot.datasetIds.includes(source));
        if (!members.length) invalid('A reference group has no sources assigned to this lot.');
        for (const source of members) { if (references.has(source)) invalid('Reference groups would count the same source twice. Choose non-overlapping reference groups.'); references.add(source); }
      }
    }
    return { id, name, datasetIds: [...lot.datasetIds], fit, k, failBin, recipes, referenceGroups };
  });
}

export function createPatRecipeDocument(selection, lots, sources) {
  const normalized = validateSelection(selection), recipes = validatePatLotPlan(normalized, lots);
  return { format: FORMAT, version: VERSION, selection: normalized, sources: idsFor(normalized).map(datasetId => {
    const source = sources.find(item => item.datasetId === datasetId);
    if (!source?.sha256) invalid('Recipe files require source hashes.');
    return { datasetId, name: source.name, sha256: source.sha256 };
  }), lots: recipes };
}

export function readPatRecipeDocument(document, selection, sources) {
  if (document?.format !== FORMAT || document.version !== VERSION) invalid('Choose a version 1 PAT lot recipe file.');
  if (!same(validateSelection(document.selection), validateSelection(selection))) invalid('Recipe scope differs from the current source order, comparison groups or filters. Restore that selection before loading.');
  const current = createPatRecipeDocument(selection, document.lots, sources);
  if (!Array.isArray(document.sources) || !same(document.sources.map(({ datasetId, sha256 }) => ({ datasetId, sha256 })), current.sources.map(({ datasetId, sha256 }) => ({ datasetId, sha256 })))) invalid('Recipe source hashes do not match this library selection.');
  return current.lots;
}

export async function previewPatLotRecipes(view, options = {}) {
  const lots = validatePatLotPlan(view.selection, options.lots), limit = boundedInteger(options.limit ?? 1000, 1, 20000, 'Preview rows');
  const decisions = [], runs = [], summary = {}, assigned = new Set(lots.flatMap(lot => lot.datasetIds));
  for (const lot of lots) for (const [group, population] of view.selection.groups.entries()) {
    if (!population.datasetIds.some(source => lot.datasetIds.includes(source))) continue;
    view.context.checkCancelled();
    const result = await previewScreening(view, { method: 'pat', ...lot, datasetIds: lot.datasetIds, candidateGroups: [group], referenceGroups: lot.referenceGroups ?? [group], limit: Math.max(1, limit - decisions.length) });
    for (const [key, value] of Object.entries(result.summary)) if (!key.endsWith('Yield')) summary[key] = (summary[key] ?? 0) + value;
    for (const decision of result.decisions) if (decisions.length < limit) decisions.push({ ...decision, lotId: lot.id, lotName: lot.name, toBin: decision.toBin ?? lot.failBin });
    runs.push({ lotId: lot.id, lotName: lot.name, group, groupName: population.name, summary: result.summary, tests: result.tests, recipe: result.recipe, warnings: result.warnings });
  }
  summary.selectedYield = summary.selectedPass + summary.selectedFail ? summary.selectedPass / (summary.selectedPass + summary.selectedFail) : null;
  summary.projectedYield = summary.projectedPass + summary.projectedFail ? summary.projectedPass / (summary.projectedPass + summary.projectedFail) : null;
  const unassignedSources = idsFor(view.selection).filter(source => !assigned.has(source)), truncated = summary.flagged > decisions.length;
  return { method: 'patLots', methodVersion: 'explicit-lot-pat-v1', summary, decisions, decisionsTruncated: truncated, runs, sources: sourceProvenance(view),
    recipe: { lots, selection: view.selection, unassignedSources, independentGroups: true, originalRetirementScope: true },
    warnings: [...(unassignedSources.length ? [`${unassignedSources.length} selected sources are unassigned and were not screened.`] : []),
      ...(truncated ? [`Preview retains ${decisions.length} of ${summary.flagged} decisions. Narrow the selection before exporting.`] : []),
      ...new Set(runs.flatMap(run => run.warnings))] };
}

function input(parent, title, value = '', options = {}) {
  const wrapper = element('label', title), field = element('input'); field.value = value ?? ''; field.setAttribute('aria-label', title);
  Object.assign(field, options); wrapper.append(field); parent.append(wrapper); return field;
}
function formFor(container, api, text, work) {
  const form = element('form', undefined, 'study-form'), fields = element('div', undefined, 'viewer-toolbar'), output = element('div', undefined, 'study-result'), submit = element('button', text, 'button primary');
  submit.type = 'submit'; form.append(fields, submit); container.append(form, output);
  form.addEventListener('submit', event => { event.preventDefault(); api.run(async () => { api.clearCharts?.(); output.replaceChildren(); await work(output); }); });
  return { form, fields, output, submit };
}
function recipeFields(parent, tests, recipes, prefix = '') {
  for (const [index, test] of tests.entries()) {
    const row = element('div', undefined, 'viewer-toolbar'); row.append(element('strong', testTitle(test))); parent.append(row);
    for (const [key, text] of [['low', 'Low limit'], ['high', 'High limit'], ['failBin', 'Test fail bin']]) {
      const field = input(row, `${prefix}${tr(text)} ${test.number}`, recipes[index][key], { type: 'number', step: key === 'failBin' ? '1' : 'any', ...(key === 'failBin' ? { min: '0', max: '65534' } : {}) });
      field.addEventListener('input', () => { recipes[index][key] = field.value === '' ? null : field.valueAsNumber; });
    }
  }
}
const testInfo = key => ({ ...parseTestKey(key), key });
async function saveJson(value, filename) { const { showDownload } = await import('./viewer-actions.js'); showDownload(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename); }

export async function renderPatLotRecipes(container, api, helpers) {
  const selection = structuredClone(api.state.selection), tests = [...api.state.selected.values()].filter(test => test.family !== 20);
  if (!tests.length) { container.append(element('p', tr('Select numeric tests for the lot recipes.'))); return; }
  const overview = await api.query('overview'), sources = overview.sources.filter((source, index, all) => all.findIndex(item => item.datasetId === source.datasetId) === index);
  let lots = [];
  const form = formFor(container, api, tr('Preview lot PAT'), async output => {
    const result = await api.query('advanced', { kind: 'patLots', lots: validatePatLotPlan(selection, lots), limit: 20000 });
    helpers.metrics(output, [['Devices', result.summary.devices], ['Eligible', result.summary.eligible], ['Flagged', result.summary.flagged]]); warnings(output, result.warnings);
    table(output, [{ label: tr('Lot'), value: row => row.lotName }, { label: tr('Group'), value: row => row.groupName }, { label: tr('Test'), value: row => testTitle(testInfo(row.testKey)) }, ...[['referenceCount', 'Reference N'], ['center', 'Center'], ['spread', 'Spread'], ['low', 'Lower limit'], ['high', 'Upper limit'], ['flagged', 'Flagged']].map(([key, label]) => ({ label: tr(label), value: row => row[key] ?? '—' })), { label: tr('Status'), value: row => row.reason ?? 'Ready', wrap: true }], result.runs.flatMap(run => run.tests.map(test => ({ ...test, lotName: run.lotName, groupName: run.groupName }))));
    helpers.drawDecisionTable(output, result, api); helpers.resultActions(output, result, 'pat-lot-preview.json', api, { screening: true });
  });
  const editor = element('div'), membership = element('div'); form.form.insertBefore(membership, form.submit); form.form.insertBefore(editor, form.submit);
  const refresh = () => {
    editor.replaceChildren(); membership.replaceChildren();
    for (const source of sources) {
      const assigned = lots.find(lot => lot.datasetIds.includes(source.datasetId));
      selectField(membership, source.name, [['', tr('Exclude from PAT')], ...lots.map(lot => [lot.id, lot.name])], assigned?.id ?? '', value => { for (const lot of lots) lot.datasetIds = lot.datasetIds.filter(id => id !== source.datasetId); if (value) lots.find(lot => lot.id === value).datasetIds.push(source.datasetId); });
    }
    for (const lot of lots) {
      const box = element('fieldset'), legend = element('legend', lot.name), row = element('div', undefined, 'viewer-toolbar'); box.append(legend, row); editor.append(box);
      const name = input(row, tr('Lot name'), lot.name, { maxLength: 120, required: true }); name.addEventListener('change', () => { lot.name = name.value; refresh(); });
      selectField(row, `${lot.name} ${tr('fit')}`, [['sigma', tr('Mean / sample sigma')], ['mad', tr('Median / MAD')]], lot.fit, value => { lot.fit = value; });
      const k = input(row, `${lot.name} ${tr('multiplier')}`, lot.k, { type: 'number', min: '.5', max: '10', step: '.1', required: true }), bin = input(row, `${lot.name} ${tr('failure bin')}`, lot.failBin, { type: 'number', min: '0', max: '65534', step: '1', required: true });
      k.addEventListener('input', () => { lot.k = k.valueAsNumber; }); bin.addEventListener('input', () => { lot.failBin = bin.valueAsNumber; });
      const reference = input(row, `${lot.name} ${tr('reference groups (optional)')}`, lot.referenceGroups?.map(group => group + 1).join(',') ?? '');
      reference.placeholder = tr('Each group independently'); reference.addEventListener('input', () => { lot.referenceGroups = reference.value.trim() ? reference.value.split(',').map(value => Number(value.trim()) - 1) : null; });
      row.append(button(tr('Remove lot'), () => { lots = lots.filter(item => item !== lot); refresh(); }, 'quiet-button'));
      recipeFields(box, lot.recipes.map(recipe => testInfo(recipe.testKey)), lot.recipes, `${lot.name} `);
    }
  };
  const add = () => { if (lots.length >= 8) throw Error('A selection supports up to eight lot recipes.'); lots.push({ id: crypto.randomUUID(), name: `Lot ${lots.length + 1}`, datasetIds: [], fit: 'sigma', k: 3, failBin: 8, referenceGroups: null, recipes: tests.map(test => ({ testKey: test.key, low: null, high: null, failBin: null })) }); refresh(); };
  form.fields.append(button(tr('Add lot'), () => api.run(async () => { add(); })), button(tr('Save lot recipes'), () => api.run(async () => { await saveJson(createPatRecipeDocument(selection, lots, sources), 'pat-lot-recipes.json'); })));
  const load = input(form.fields, tr('Load lot recipes'), '', { type: 'file', accept: '.json,application/json' }); load.addEventListener('change', () => api.run(async () => { const file = load.files[0]; if (!file) return; if (file.size > 1024 * 1024) throw Error('Recipe files must be at most 1 MiB.'); lots = readPatRecipeDocument(JSON.parse(await file.text()), selection, sources); refresh(); }));
  form.form.append(element('p', `Assign each file explicitly. Blank test limits fit known passes; one bound creates a manual one-sided screen. Reference groups use these numbers: ${selection.groups.map((group, index) => `${index + 1}: ${group.name}`).join('; ')}. Blank references fit each group independently.`, 'viewer-help'));
  add();
}

export function renderSpatialRecipeControls(parent, { prefix = '', method = 'gdbn', failureBin = method === 'gdbn' ? 7 : 9 } = {}) {
  const controls = {};
  for (const [key, title, value, min, max, step] of [['failBin', 'Failure bin', failureBin, 0, 65534, 1], ['radius', 'Radius', 1, 1, 10, 1], ['minNeighbors', 'Minimum known neighbors', 1, 1, 440, 1], ['minFailNeighbors', 'Failing neighbors', 3, 1, 440, 1], ['minCluster', 'Minimum cluster', 3, 1, 50000, 1], ['failFraction', 'Fail fraction', .5, 0, 1, .01]]) controls[key] = input(parent, `${prefix}${tr(title)}`, value, { type: 'number', min: String(min), max: String(max), step: String(step), required: true });
  const connectivity = selectField(parent, `${prefix}${tr('Connectivity')}`, [['4', tr('4 neighbors')], ['8', tr('8 neighbors')]], '8', () => {}), calcMode = selectField(parent, `${prefix}${tr('Density weights')}`, [['uniform', tr('Uniform')], ['weighted', tr('Distance weighted')]], 'uniform', () => {}), exemptions = input(parent, `${prefix}${tr('Exempt bins (comma separated)')}`);
  return { read: () => ({ ...Object.fromEntries(Object.entries(controls).map(([key, field]) => [key, field.valueAsNumber])), connectivity: Number(connectivity.value), calcMode: calcMode.value, exemptBins: exemptions.value.trim() ? exemptions.value.split(',').map(value => Number(value.trim())) : [] }) };
}

export async function renderCombinedScreening(container, api, helpers) {
  const tests = [...api.state.selected.values()].filter(test => test.family !== 20), recipes = tests.map(test => ({ testKey: test.key, low: null, high: null, failBin: null })), enabled = {}, spatial = {};
  let priority, fit, k, failureBin, reference;
  const form = formFor(container, api, tr('Preview combined screening'), async output => {
    const order = priority.value.split(',').filter(method => enabled[method].checked), rules = {};
    for (const method of order) rules[method] = method === 'pat' ? { recipes, fit: fit.value, k: k.valueAsNumber, failBin: failureBin.valueAsNumber, ...(reference.value.trim() ? { referenceGroups: reference.value.split(',').map(value => Number(value.trim()) - 1) } : {}) } : spatial[method].read();
    const result = await api.query('advanced', { kind: 'combined', priority: order, rules }); helpers.metrics(output, Object.entries(result.summary)); warnings(output, result.warnings); helpers.drawDecisionTable(output, result, api); detail(output, tr('Rule summaries'), result.ruleSummaries); helpers.resultActions(output, result, 'combined-screening.json', api, { screening: true });
  });
  priority = selectField(form.fields, tr('First matching rule wins'), ['pat,gdbn,cd', 'pat,cd,gdbn', 'gdbn,pat,cd', 'gdbn,cd,pat', 'cd,pat,gdbn', 'cd,gdbn,pat'].map(value => [value, value.toUpperCase().replaceAll(',', ' → ')]), 'pat,gdbn,cd', () => {});
  for (const [method, name] of [['pat', 'PAT'], ['gdbn', 'GDBN'], ['cd', 'Cluster detection']]) {
    const box = element('fieldset'), legend = element('legend'), checked = element('input'), controls = element('div', undefined, 'viewer-toolbar'); checked.type = 'checkbox'; checked.checked = method !== 'pat' || tests.length > 0; checked.setAttribute('aria-label', `${tr('Enable')} ${tr(name)}`); legend.append(checked, document.createTextNode(tr(name))); box.append(legend, controls); form.form.insertBefore(box, form.submit); enabled[method] = checked;
    const visibility = () => { controls.hidden = !checked.checked; for (const field of controls.querySelectorAll('input,select')) field.disabled = !checked.checked; }; checked.addEventListener('change', visibility);
    if (method === 'pat') {
      fit = selectField(controls, tr('PAT fit'), [['sigma', tr('Mean / sample sigma')], ['mad', tr('Median / MAD')]], 'mad', () => {});
      k = input(controls, tr('PAT multiplier'), 3, { type: 'number', min: '.5', max: '10', step: '.1', required: true }); failureBin = input(controls, tr('PAT failure bin'), 8, { type: 'number', min: '0', max: '65534', step: '1', required: true }); reference = input(controls, tr('PAT reference groups (optional)'));
      recipeFields(controls, tests, recipes, 'PAT '); if (!tests.length) controls.append(element('p', tr('Select numeric tests to enable PAT.')));
    } else spatial[method] = renderSpatialRecipeControls(controls, { method, prefix: `${tr(name)} ` });
    visibility();
  }
  form.form.append(element('p', `All rules read original data independently. Priority chooses the output bin; every reason remains recorded. PAT reference group numbers: ${api.state.selection.groups.map((group, index) => `${index + 1}: ${group.name}`).join('; ')}. Blank references use all groups.`, 'viewer-help'));
}
