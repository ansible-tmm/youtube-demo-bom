/**
 * Spreadsheet UI: custom menu and optional time-driven trigger helpers.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('YouTube BOM')
    .addItem('Sync YouTube', 'syncYouTube')
    .addItem('Ensure sheet structure', 'ensureSheetStructure')
    .addSeparator()
    .addItem('Authorize Brand YouTube Account', 'authorizeBrandYouTube')
    .addItem('List Brand OAuth channels', 'listBrandYouTubeChannels')
    .addItem('Reset Brand YouTube auth', 'resetBrandYouTubeAuth')
    .addSeparator()
    .addItem('List my YouTube channels (built-in)', 'listMyYouTubeChannels')
    .addItem('Add scheduled video IDs…', 'promptAddExtraVideoIds')
    .addItem('Suggest demo slugs (from DemoMap)', 'suggestDemoSlugs')
    .addSeparator()
    .addItem('Install hourly sync trigger', 'installHourlyTrigger')
    .addItem('Remove sync triggers', 'removeSyncTriggers')
    .addToUi();
}

/**
 * Create a time-driven trigger that calls syncYouTube every hour.
 * Requires Brand OAuth (recommended) or built-in auth still valid.
 */
function installHourlyTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('syncYouTube').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert(
    'Hourly trigger installed.\n\n' +
      'Prefer Brand OAuth so scheduled videos keep syncing.\n' +
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
