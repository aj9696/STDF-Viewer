import { element, bytes } from './library-home-view.js';

/** Small bundled sources use the normal importer and duplicate detection. */
export function createExamplePicker(api) {
  let activeDialog, pending = false;
  async function open() {
    if (!api.available() || activeDialog?.open) return;
    const dialog = element('dialog', undefined, 'modal example-picker');
    activeDialog = dialog;
    dialog.id = 'example-dialog'; dialog.setAttribute('aria-labelledby', 'example-title');
    const heading = element('div', undefined, 'dialog-heading'), title = element('h2', 'Example data');
    title.id = 'example-title';
    const close = element('button', '×', 'icon-button'); close.type = 'button'; close.setAttribute('aria-label', 'Close example data');
    close.addEventListener('click', () => dialog.close()); heading.append(title, close);
    const note = element('p', 'Small synthetic STDFs. Open one to try it.', 'muted');
    const status = element('p', 'Loading examples…', 'example-status'); status.setAttribute('role', 'status');
    const list = element('div', undefined, 'example-list');
    dialog.append(heading, note, list, status); document.body.append(dialog);
    dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    const currentDialog = dialog;
    try {
      const response = await fetch(new URL('./examples/manifest.json', import.meta.url));
      if (!response.ok) throw new Error('Example files are unavailable. Reload to try again.');
      const manifest = await response.json();
      if (!currentDialog.open) return;
      for (const example of manifest.examples) {
        const row = element('article', undefined, 'example-row'), copy = element('div');
        copy.append(element('h3', example.title), element('p', example.description));
        const links = element('div', undefined, 'example-files');
        for (const file of example.files) {
          const link = element('a', `${file.name} · ${bytes(file.bytes)}`);
          link.href = new URL(`./${file.url}`, import.meta.url).href; link.download = file.name; links.append(link);
        }
        copy.append(links);
        const button = element('button', 'Open', 'button secondary'); button.type = 'button';
        button.setAttribute('aria-label', `Open ${example.title}`); button.dataset.example = example.id;
        button.addEventListener('click', () => load(example)); row.append(copy, button); list.append(row);
      }
      status.textContent = '';
    } catch (error) { if (currentDialog.open) status.textContent = error.message; }

    async function load(example) {
      if (pending || !api.available()) return;
      pending = true;
      dialog.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      await api.run(async (epoch) => {
        const ids = [];
        try {
          for (const file of example.files) {
            status.textContent = `Opening ${file.name}…`;
            const response = await fetch(new URL(`./${file.url}`, import.meta.url));
            if (!response.ok) throw new Error(`Could not load ${file.name}. Try again.`);
            const buffer = await response.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', buffer);
            const hash = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
            if (buffer.byteLength !== file.bytes || hash !== file.sha256) throw new Error(`${file.name} is incomplete. Reload and try again.`);
            const result = await api.client().importFile(new File([buffer], file.name, { type: 'application/octet-stream' }));
            ids.push(result.dataset.id);
          }
          await api.refresh(epoch);
          api.openViewer(ids, example);
        } catch (error) {
          status.textContent = `${error.message}${ids.length ? ' Files already imported are in your library.' : ''}`;
          if (!api.client().worker) { dialog.close(); throw error; }
          await api.refresh(epoch);
        } finally {
          pending = false;
          dialog.querySelectorAll('button').forEach((button) => { button.disabled = false; });
        }
      });
    }
  }
  return { open };
}
