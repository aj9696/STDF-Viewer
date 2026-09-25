import { validateSelection } from './viewer-model.js';
import { element } from './library-home-view.js';

/** Editing is isolated until Apply; reordering never mutates saved source data. */
export function editGroups(selection, datasets, onApply) {
  const dialog = document.getElementById('viewer-groups-dialog');
  const container = document.getElementById('viewer-group-editor');
  const error = document.getElementById('viewer-group-error');
  const groups = structuredClone(selection.groups);
  const names = new Map(datasets.map((d) => [d.id, d.name]));
  const button = (label, action) => { const b = element('button', label); b.type = 'button'; b.addEventListener('click', action); return b; };
  const render = () => {
    const active = document.activeElement, groupIndex = [...container.children].indexOf(active?.closest('.viewer-group'));
    const name = active?.getAttribute('aria-label'), text = active?.textContent;
    container.replaceChildren(); error.textContent = '';
    groups.forEach((group, index) => {
      const section = element('section', undefined, 'viewer-group');
      const header = element('header'), input = element('input');
      input.value = group.name; input.maxLength = 120; input.setAttribute('aria-label', `Group ${index + 1} name`);
      input.addEventListener('input', () => { group.name = input.value; });
      const remove = button('Remove group', () => { groups.splice(index, 1); render(); }); remove.disabled = groups.length === 1;
      header.append(input, remove); section.append(header);
      const list = element('ol');
      group.datasetIds.forEach((id, sourceIndex) => {
        const row = element('li'); row.append(element('span', `${sourceIndex + 1}. ${names.get(id) ?? 'Unavailable source'}`));
        const move = (delta) => { const other = sourceIndex + delta; [group.datasetIds[sourceIndex], group.datasetIds[other]] = [group.datasetIds[other], group.datasetIds[sourceIndex]]; render(); };
        const up = button('Move up', () => move(-1)), down = button('Move down', () => move(1));
        up.disabled = sourceIndex === 0; down.disabled = sourceIndex === group.datasetIds.length - 1;
        up.setAttribute('aria-label', `Move ${names.get(id)} earlier in group ${index + 1}`); down.setAttribute('aria-label', `Move ${names.get(id)} later in group ${index + 1}`);
        row.append(up, down, button('Remove file', () => { group.datasetIds.splice(sourceIndex, 1); render(); })); list.append(row);
      });
      section.append(list);
      const label = element('label', 'Add a saved file'), select = element('select');
      select.setAttribute('aria-label', `Saved file for group ${index + 1}`);
      for (const dataset of datasets.filter((d) => !group.datasetIds.includes(d.id))) {
        const option = element('option', dataset.name); option.value = dataset.id; select.append(option);
      }
      label.append(select); const add = button('Add file to group', () => { if (select.value) group.datasetIds.push(select.value); render(); });
      add.disabled = !select.options.length || group.datasetIds.length >= 8; section.append(label, add); container.append(section);
    });
    document.getElementById('viewer-add-group').disabled = groups.length >= 8;
    if (dialog.open && active && !active.isConnected) {
      const scope = container.children[Math.min(Math.max(0, groupIndex), groups.length - 1)];
      const replacement = [...scope.querySelectorAll('button,input,select')].find((el) => !el.disabled && (name ? el.getAttribute('aria-label') === name : el.textContent === text));
      (replacement ?? scope.querySelector('input')).focus();
    }
  };
  document.getElementById('viewer-add-group').onclick = () => { groups.push({ name: `Group ${groups.length + 1}`, datasetIds: [] }); render(); };
  document.getElementById('viewer-apply-groups').onclick = () => {
    try { const next = validateSelection({ ...selection, groups }); dialog.close(); onApply(next); }
    catch (e) { error.textContent = e.message; }
  };
  render(); dialog.showModal();
}
