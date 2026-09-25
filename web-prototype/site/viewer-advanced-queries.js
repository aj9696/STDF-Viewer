import { invalid } from './viewer-model.js';

/** Fixed routing keeps UI tools on the same validated, read-only population. */
export async function runAdvancedQuery(view, options) {
  switch (options.kind) {
    case 'dashboard': return (await import('./viewer-dashboard.js')).dashboard(view, options);
    case 'recordSummary': return (await import('./viewer-dashboard.js')).recordSummary(view, options);
    case 'distributions': return (await import('./viewer-distributions.js')).compareDistributions(view, options);
    case 'correlation': return (await import('./viewer-correlations.js')).correlateTests(view, options);
    case 'screening': return (await import('./viewer-screening.js')).previewScreening(view, options);
    case 'patLots': return (await import('./viewer-pat-recipes.js')).previewPatLotRecipes(view, options);
    case 'pvt': return (await import('./viewer-studies.js')).pvtStudy(view, options);
    case 'grr': return (await import('./viewer-studies.js')).gaugeStudy(view, options);
    case 'waferValues': return (await import('./viewer-wafer-studies.js')).waferValues(view, options);
    case 'waferGallery': return (await import('./viewer-wafer-studies.js')).waferGallery(view, options);
    case 'waferAggregate': return (await import('./viewer-wafer-aggregate.js')).waferValueAggregate(view, options);
    case 'spatial': return (await import('./viewer-wafer-studies.js')).spatialScreening(view, options);
    case 'combined': return (await import('./viewer-reclassification.js')).combinedScreening(view, options);
    default: invalid('Unknown study.');
  }
}
