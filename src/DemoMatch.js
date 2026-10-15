/**
 * Optional: suggest Demo slug values from a DemoMap sheet.
 *
 * Create a sheet named DemoMap with headers:
 *   video_id | demo_slug | source_url
 *
 * Populate it offline (see scripts/suggest_demo_slugs.py from demos.yml),
 * then run "Suggest demo slugs" — fills BOM "Demo slug" only where blank.
 * Never overwrites an existing Demo slug.
 */

var DEMO_MAP_SHEET = 'DemoMap';

function suggestDemoSlugs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bom = ss.getSheetByName(CONFIG.SHEETS.BOM);
  var mapSheet = ss.getSheetByName(DEMO_MAP_SHEET);

  if (!bom) {
    throw new Error('BOM sheet missing. Run Ensure sheet structure first.');
  }
  if (!mapSheet) {
    SpreadsheetApp.getUi().alert(
      'Create a sheet named DemoMap with columns:\n' +
        'video_id | demo_slug | source_url\n\n' +
        'Then paste mappings (see scripts/suggest_demo_slugs.py).'
    );
    return;
  }

  var mapping = loadDemoMap_(mapSheet);
  var lastRow = bom.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('BOM has no data rows yet. Sync YouTube first.');
    return;
  }

  var demoSlugCol = CONFIG.BOM_HUMAN_START_COL + 1; // 1-based
  var videoIds = bom.getRange(2, 1, lastRow - 1, 1).getValues();
  var demoSlugs = bom.getRange(2, demoSlugCol, lastRow - 1, 1).getValues();

  var filled = 0;
  for (var i = 0; i < videoIds.length; i++) {
    var vid = String(videoIds[i][0] || '').trim();
    var existing = String(demoSlugs[i][0] || '').trim();
    if (!vid || existing) {
      continue;
    }
    if (mapping[vid]) {
      demoSlugs[i][0] = mapping[vid];
      filled++;
    }
  }

  if (filled > 0) {
    bom.getRange(2, demoSlugCol, lastRow - 1, 1).setValues(demoSlugs);
  }

  SpreadsheetApp.getUi().alert(
    'Suggested demo slugs: filled ' +
      filled +
      ' blank cell(s). Existing values were not changed.'
  );
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object<string, string>}
 */
function loadDemoMap_(sheet) {
  var values = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var vid = extractVideoId_(String(values[i][0] || ''));
    var slug = String(values[i][1] || '').trim();
    if (vid && slug) {
      map[vid] = slug;
    }
  }
  return map;
}

/**
 * Extract an 11-char YouTube video ID from a bare ID or URL.
 * @param {string} text
 * @return {string}
 */
function extractVideoId_(text) {
  var t = String(text || '').trim();
  if (!t) return '';
  if (/^[\w-]{11}$/.test(t)) return t;

  var patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = t.match(patterns[i]);
    if (m) return m[1];
  }
  return '';
}
