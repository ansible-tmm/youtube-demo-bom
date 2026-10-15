/**
 * Brand Account workaround: scheduled/private videos often do not appear in the
 * public uploads playlist under Apps Script OAuth (no brand-account picker),
 * even for Primary owners. Paste Studio video IDs/URLs into _extra_video_ids;
 * sync merges them via Videos.list.
 */

/**
 * Prompt for one or more video IDs / Studio URLs and append to _extra_video_ids.
 */
function promptAddExtraVideoIds() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    'Add scheduled / private videos',
    'Paste video IDs or Studio/YouTube URLs (one per line or comma-separated).\n\n' +
      'In Studio: open the scheduled video → copy the ID from the URL\n' +
      '(…/video/VIDEO_ID/edit).',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  var text = result.getResponseText() || '';
  var parts = text.split(/[\s,;]+/);
  var added = appendExtraVideoIds_(parts);

  ui.alert(
    'Added ' +
      added +
      ' ID(s) to _extra_video_ids.\n\n' +
      'Run YouTube BOM → Sync YouTube next.\n' +
      'Success dialog should show Extra IDs resolved and Status scheduled=…'
  );
}

/**
 * @param {string[]} rawParts
 * @return {number} how many new IDs appended
 */
function appendExtraVideoIds_(rawParts) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensureHeaderSheet_(
    ss,
    CONFIG.SHEETS.EXTRA_IDS,
    CONFIG.EXTRA_ID_HEADERS
  );

  var existing = {};
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var ex = extractVideoId_(String(values[i][0] || ''));
    if (ex) existing[ex] = true;
  }

  var added = 0;
  for (var p = 0; p < rawParts.length; p++) {
    var id = extractVideoId_(String(rawParts[p] || ''));
    if (!id || existing[id]) continue;
    existing[id] = true;
    sheet.appendRow([id, 'scheduled (manual)']);
    added++;
  }
  return added;
}
