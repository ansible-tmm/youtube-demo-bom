/**
 * Pattern A sync:
 * 1. Full-replace _youtube_raw from the YouTube API.
 * 2. Append new Video ID rows to BOM (auto formula columns only).
 * 3. Never touch human columns or rows with a blank Video ID.
 */

/**
 * Ensure required sheets and header rows exist.
 * Safe to run repeatedly; does not wipe human BOM data.
 */
function ensureSheetStructure() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureConfigSheet_(ss);
  ensureHeaderSheet_(ss, CONFIG.SHEETS.RAW, CONFIG.RAW_HEADERS);
  ensureHeaderSheet_(ss, CONFIG.SHEETS.BOM, CONFIG.BOM_HEADERS);

  applyBomDataValidation_(ss.getSheetByName(CONFIG.SHEETS.BOM));
  SpreadsheetApp.getUi().alert(
    'Sheet structure ready.\n\nTabs: _config, _youtube_raw, BOM'
  );
}

function ensureConfigSheet_(ss) {
  var name = CONFIG.SHEETS.CONFIG;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 4, 2).setValues([
      ['key', 'value'],
      ['channel_handle', CONFIG.DEFAULT_CHANNEL_HANDLE],
      ['channel_id', ''],
      ['include_scheduled', 'true']
    ]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 280);
  }
  return sheet;
}

function ensureHeaderSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsHeader = existing.every(function (c) {
    return String(c).trim() === '';
  });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function applyBomDataValidation_(bom) {
  if (!bom) return;
  // Review status: 0-based human start 10 + offset 4 → col index 14 → 1-based 15
  var reviewCol = CONFIG.BOM_HUMAN_START_COL + 4 + 1;
  var numRows = Math.max(bom.getMaxRows() - 1, 500);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.REVIEW_STATUS_VALUES, true)
    .setAllowInvalid(true)
    .build();
  bom.getRange(2, reviewCol, numRows, 1).setDataValidation(rule);
}

/**
 * Main sync entry point (menu + triggers).
 */
function syncYouTube() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureConfigSheet_(ss);
  var raw = ensureHeaderSheet_(ss, CONFIG.SHEETS.RAW, CONFIG.RAW_HEADERS);
  var bom = ensureHeaderSheet_(ss, CONFIG.SHEETS.BOM, CONFIG.BOM_HEADERS);

  var pulled = pullChannelVideos_();
  var rows = pulled.rows;

  replaceRawSheet_(raw, rows);
  var appended = appendNewBomRows_(bom, rows);

  var msg =
    'Synced ' +
    rows.length +
    ' videos from "' +
    pulled.channel.title +
    '".\n' +
    'Appended ' +
    appended +
    ' new BOM row(s).\n' +
    'Human columns and blank-Video-ID rows were left untouched.';

  try {
    SpreadsheetApp.getUi().alert('YouTube sync complete', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Time-driven triggers have no UI.
    Logger.log(msg);
  }
}

/**
 * Full replace of _youtube_raw data (keeps header).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} raw
 * @param {Array[]} rows
 */
function replaceRawSheet_(raw, rows) {
  var lastRow = raw.getLastRow();
  if (lastRow > 1) {
    raw.getRange(2, 1, lastRow - 1, CONFIG.RAW_HEADERS.length).clearContent();
  }

  if (!rows.length) {
    return;
  }

  raw
    .getRange(2, 1, rows.length, CONFIG.RAW_HEADERS.length)
    .setValues(rows);

  // Format date columns: Published (E=5), Last synced (K=11)
  raw.getRange(2, 5, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  raw.getRange(2, 11, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

/**
 * Append BOM rows for video IDs not already present.
 * Rows with blank Video ID are ignored forever (checklist items).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @param {Array[]} rawRows
 * @return {number} count appended
 */
function appendNewBomRows_(bom, rawRows) {
  var existing = collectBomVideoIds_(bom);
  var toAppend = [];

  for (var i = 0; i < rawRows.length; i++) {
    var videoId = String(rawRows[i][0] || '').trim();
    if (!videoId || existing[videoId]) {
      continue;
    }
    existing[videoId] = true;
    toAppend.push(videoId);
  }

  if (!toAppend.length) {
    return 0;
  }

  var startRow = Math.max(bom.getLastRow() + 1, 2);
  var width = CONFIG.BOM_HEADERS.length;
  var values = [];

  for (var j = 0; j < toAppend.length; j++) {
    var rowNum = startRow + j;
    var row = new Array(width);
    for (var c = 0; c < width; c++) {
      row[c] = '';
    }
    row[0] = toAppend[j];
    // Auto columns 1–9: live XLOOKUP into _youtube_raw (same column order for Title…Duration;
    // Last synced at maps to raw col 11 / index 10).
    row[1] = bomLookupFormula_(rowNum, 2); // Title → raw B
    row[2] = bomLookupFormula_(rowNum, 3); // URL → raw C
    row[3] = bomLookupFormula_(rowNum, 4); // Status → raw D
    row[4] = bomLookupFormula_(rowNum, 5); // Published → raw E
    row[5] = bomLookupFormula_(rowNum, 6); // Views → raw F
    row[6] = bomLookupFormula_(rowNum, 7); // Likes → raw G
    row[7] = bomLookupFormula_(rowNum, 8); // Comments → raw H
    row[8] = bomLookupFormula_(rowNum, 9); // Duration → raw I
    row[9] = bomLookupFormula_(rowNum, 11); // Last synced → raw K
    values.push(row);
  }

  bom.getRange(startRow, 1, toAppend.length, width).setValues(values);
  bom
    .getRange(startRow, 5, toAppend.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm');
  bom
    .getRange(startRow, 10, toAppend.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm');

  applyBomDataValidation_(bom);
  return toAppend.length;
}

/**
 * XLOOKUP formula: Video ID in column A → column colIndex (1-based) on _youtube_raw.
 * @param {number} rowNum BOM row number
 * @param {number} rawColIndex 1-based column on _youtube_raw
 * @return {string}
 */
function bomLookupFormula_(rowNum, rawColIndex) {
  var raw = CONFIG.SHEETS.RAW;
  var colLetter = columnToLetter_(rawColIndex);
  return (
    '=IF($A' +
    rowNum +
    '="","",IFERROR(XLOOKUP($A' +
    rowNum +
    ",'" +
    raw +
    "'!$A:$A,'" +
    raw +
    "'!$" +
    colLetter +
    ':$' +
    colLetter +
    '),""))'
  );
}

function columnToLetter_(col) {
  var temp = '';
  var n = col;
  while (n > 0) {
    var rem = (n - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    n = Math.floor((n - 1) / 26);
  }
  return temp;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @return {Object<string, boolean>}
 */
function collectBomVideoIds_(bom) {
  var map = {};
  var lastRow = bom.getLastRow();
  if (lastRow < 2) return map;

  var ids = bom.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '').trim();
    if (id) {
      map[id] = true;
    }
  }
  return map;
}
