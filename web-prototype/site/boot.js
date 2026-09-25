// A classic script can run on file://, where the application's module graph
// cannot. Explain the correct launch address before starting any library work.
(() => {
  const script = document.currentScript;
  const MODULE_LOAD_TIMEOUT_MS = 15_000;
  const notice = document.getElementById('boot-error');
  const title = document.getElementById('boot-error-title');
  const message = document.getElementById('boot-error-text');
  const libraryLink = document.getElementById('boot-library');
  const reload = document.getElementById('boot-reload');
  const status = document.getElementById('connection-status') ?? document.getElementById('explorer-status');
  const loader = document.getElementById('loading-library') ?? document.getElementById('viewer-progress');

  function explain(heading, detail) {
    title.textContent = heading;
    message.textContent = detail;
    notice.hidden = false;
    if (loader) loader.hidden = true;
    if (status) status.textContent = 'App not started';
    document.getElementById('main')?.setAttribute('aria-busy', 'false');
    const viewer = document.getElementById('viewer-panel');
    if (viewer) viewer.textContent = 'Waiting for the app to start. Use the launch guidance above.';
    const dataset = document.getElementById('explorer-dataset');
    if (dataset) dataset.textContent = 'Open a dataset from Data library.';
    const caption = document.getElementById('library-caption') ?? document.getElementById('test-count');
    if (caption) caption.textContent = 'Waiting for the app to start.';
  }
  reload.addEventListener('click', () => location.reload());
  if (location.protocol === 'file:') {
    libraryLink.href = 'http://127.0.0.1:8766/app.html';
    reload.hidden = true;
    explain('Open SemiData from its local app address',
      'This HTML file cannot run directly from disk. Select Open Data library below, then choose a saved dataset and Open data viewer. If that address is unavailable, start the local server using the browser app README. Each browser profile has its own saved library.');
    return;
  }

  libraryLink.href = new URL('./app.html', script.src).href;
  const timer = setTimeout(() => explain('App files are taking too long to load',
    'Check that the local server is running, then reload the app. This has not reset your saved library.'), MODULE_LOAD_TIMEOUT_MS);
  import(new URL(script.dataset.entry, script.src).href).then(() => {
    clearTimeout(timer);
    notice.hidden = true;
  }).catch((error) => {
    clearTimeout(timer);
    explain('The app files could not be loaded',
      'Check that the local server is running, then reload the app. Your saved library has not been reset.');
    console.error('SemiData could not load its application module:', error);
  });
})();
