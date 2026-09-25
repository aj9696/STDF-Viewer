import { element, bytes } from './library-home-view.js';

/** Dedicated text import keeps the existing STDF/folder queue unchanged. */
export function createAtdfImporter({ available, run, client, refresh, openViewer }) {
  return {
    open() {
      if (!available()) return;
      const dialog = element('dialog', undefined, 'modal atdf-import-modal');
      dialog.id = 'atdf-import-dialog'; dialog.setAttribute('aria-labelledby', 'atdf-import-title');
      const heading = element('div', undefined, 'dialog-heading'), title = element('h2', 'Import ATDF');
      title.id = 'atdf-import-title';
      const close = element('button', 'Close', 'quiet-button'); close.type = 'button';
      heading.append(title, close);
      const form = element('form'), fileLabel = element('label', 'ATDF file'), file = element('input');
      file.type = 'file'; file.accept = '.atdf'; file.required = true; file.setAttribute('aria-label', 'ATDF file'); fileLabel.append(file);
      const offsetLabel = element('label', 'Timestamp UTC offset (minutes)'), offset = element('input');
      offset.type = 'number'; offset.min = -840; offset.max = 840; offset.step = 1; offset.value = '0'; offset.required = true;
      offset.setAttribute('aria-label', 'Timestamp UTC offset (minutes)'); offsetLabel.append(offset);
      const note = element('p', '0 means UTC. Original text is retained separately from the converted STDF.', 'dialog-intro');
      const progress = element('progress'); progress.max = 100; progress.hidden = true; progress.setAttribute('aria-label', 'ATDF import progress');
      const status = element('p', '', 'import-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const actions = element('div', undefined, 'dialog-actions'), cancel = element('button', 'Cancel import', 'button secondary'), submit = element('button', 'Import ATDF', 'button primary');
      cancel.type = 'button'; cancel.hidden = true; submit.type = 'submit'; actions.append(cancel, submit);
      const result = element('div', undefined, 'atdf-import-result');
      form.append(fileLabel, offsetLabel, note, progress, status, actions, result); dialog.append(heading, form); document.body.append(dialog);
      let pending = false, cancelling = false; const urls = [];
      const resetLinks = () => { urls.splice(0).forEach(url => URL.revokeObjectURL(url)); result.replaceChildren(); };
      const controls = () => { file.disabled = offset.disabled = submit.disabled = close.disabled = pending; cancel.hidden = !pending; cancel.disabled = cancelling; };
      const message = (text, state = '') => { status.textContent = text; status.className = `import-status ${state}`; };
      const download = (blob, filename, label) => { const link = element('a', label, 'button secondary'), url = URL.createObjectURL(blob); urls.push(url); link.href = url; link.download = filename; return link; };
      close.addEventListener('click', () => { if (!pending) dialog.close(); });
      dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
      dialog.addEventListener('close', () => { resetLinks(); dialog.remove(); }, { once: true });
      cancel.addEventListener('click', async () => { if (!pending || cancelling) return; cancelling = true; controls(); message('Cancelling import…'); await client().cancel(); });
      form.addEventListener('submit', event => {
        event.preventDefault(); if (pending || !form.reportValidity()) return;
        void run(async epoch => {
          const library = client(), previousProgress = library.onProgress;
          pending = true; cancelling = false; controls(); resetLinks(); progress.hidden = false; progress.removeAttribute('value'); message('Preparing ATDF…');
          library.onProgress = event => {
            const labels = { 'atdf-conversion': 'Converting ATDF', snapshot: 'Copying STDF', parsing: 'Reading test records', validating: 'Checking dataset', publishing: 'Saving dataset' };
            const measurable = Number.isFinite(event.totalBytes) && event.totalBytes > 0;
            if (measurable) progress.value = Math.min(100, 100 * event.completedBytes / event.totalBytes); else progress.removeAttribute('value');
            message(`${labels[event.phase] ?? event.phase}${measurable ? ` · ${bytes(event.completedBytes)} of ${bytes(event.totalBytes)}` : ''}`);
          };
          try {
            const imported = await library.viewerAuthoring('importAtdf', undefined, { file: file.files[0], utcOffsetMinutes: offset.valueAsNumber });
            await refresh(epoch);
            message(imported.duplicate ? 'Already imported — using the saved dataset.' : 'Imported.', 'success');
            const open = element('button', 'Open viewer', 'button primary'); open.type = 'button'; open.addEventListener('click', () => { if (!pending) openViewer([imported.dataset.id]); });
            result.append(open, download(imported.originalFile, imported.originalFilename, 'Download original ATDF'), download(new Blob([JSON.stringify(imported.atdf, null, 2)], { type: 'application/json' }), `${imported.originalFilename}.receipt.json`, 'Download receipt'));
          } catch (error) { message(error.code === 'CANCELLED' ? 'Import cancelled. Saved datasets are unchanged.' : `Import failed: ${error.message ?? error}`, error.code === 'CANCELLED' ? '' : 'error'); if (!library.worker) throw error; }
          finally { library.onProgress = previousProgress; pending = false; cancelling = false; progress.hidden = true; controls(); }
        });
      });
      dialog.showModal();
    },
  };
}
