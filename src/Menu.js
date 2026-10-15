/**
 * Spreadsheet UI: custom menu and optional time-driven trigger helpers.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('YouTube BOM')
    .addItem('Sync YouTube', 'syncYouTube')
    .addItem('Ensure sheet structure', 'ensureSheetStructure')
    .addSeparator()
    .addItem('Suggest demo slugs (from DemoMap)', 'suggestDemoSlugs')
    .addSeparator()
    .addItem('Install hourly sync trigger', 'installHourlyTrigger')
    .addItem('Remove sync triggers', 'removeSyncTriggers')
    .addToUi();
}

/**
 * Create a time-driven trigger that calls syncYouTube every hour.
 * Requires the user who installs it to have authorized YouTube + Sheets.
 */
function installHourlyTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('syncYouTube').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert(
    'Hourly trigger installed.\n\n' +
      'It runs as you; keep YouTube authorization valid.\n' +
      'Use "Remove sync triggers" to disable.'
  );
}

/**
 * Delete all project triggers that call syncYouTube.
 */
function removeSyncTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncYouTube') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
