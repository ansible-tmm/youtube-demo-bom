/**
 * YouTube Data API helpers (Apps Script Advanced Service: YouTube v3).
 *
 * Private / scheduled videos are only returned when the OAuth user is an
 * owner or manager of that channel AND we resolve the channel via mine
 * (or an authorized uploads playlist). Owning the Google Sheet alone is
 * not enough — YouTube authorization is separate from Sheets.
 */

/**
 * Resolve uploads playlist for the configured channel.
 * Prefers mine-matching managed channels so scheduled/private are visible.
 * @param {Object} cfg from getSyncConfig_()
 * @return {{channelId: string, uploadsPlaylistId: string, title: string, authPath: string}}
 */
function resolveChannel_(cfg) {
  var mode = (cfg.authMode || 'auto').toLowerCase();
  var mineMatch = findManagedChannel_(cfg);

  if (mode === 'mine') {
    if (!mineMatch) {
      throw new Error(
        'auth_mode=mine but no managed channel matched handle/id.\n' +
          'Use YouTube BOM → List my YouTube channels, then set channel_id.\n' +
          'If the channel is a Brand Account, re-authorize as that brand manager.'
      );
    }
    return mineMatch;
  }

  if (mode === 'auto' && mineMatch) {
    return mineMatch;
  }

  return resolveChannelPublic_(cfg);
}

/**
 * Channels the signed-in user owns/manages (includes private uploads access).
 * @param {Object} cfg
 * @return {Object|null}
 */
function findManagedChannel_(cfg) {
  var wantId = String(cfg.channelId || '').trim();
  var wantHandle = String(cfg.channelHandle || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();

  var pageToken = null;
  do {
    var opts = {
      mine: true,
      maxResults: 50
    };
    if (pageToken) {
      opts.pageToken = pageToken;
    }

    var response = YouTube.Channels.list('snippet,contentDetails', opts);
    var items = response.items || [];

    for (var i = 0; i < items.length; i++) {
      var ch = items[i];
      var customUrl = normalizeHandle_(
        (ch.snippet && ch.snippet.customUrl) || ''
      );
      var title = ((ch.snippet && ch.snippet.title) || '').toLowerCase();
      var idMatch = wantId && ch.id === wantId;
      var handleMatch =
        wantHandle &&
        (customUrl === wantHandle ||
          customUrl === wantHandle.toLowerCase() ||
          title.indexOf(wantHandle) !== -1);

      if (idMatch || handleMatch || (!wantId && !wantHandle && items.length === 1)) {
        return channelResult_(ch, 'mine (managed channel)');
      }
    }

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return null;
}

/**
 * Public resolution via channel id or handle (typically public videos only).
 * @param {Object} cfg
 * @return {Object}
 */
function resolveChannelPublic_(cfg) {
  var response;

  if (cfg.channelId) {
    response = YouTube.Channels.list('snippet,contentDetails', {
      id: cfg.channelId
    });
  } else if (cfg.channelHandle) {
    response = YouTube.Channels.list('snippet,contentDetails', {
      forHandle: cfg.channelHandle
    });
  } else {
    throw new Error(
      'Set channel_handle or channel_id in the _config sheet.'
    );
  }

  if (!response.items || !response.items.length) {
    throw new Error(
      'Channel not found for handle="' +
        cfg.channelHandle +
        '" id="' +
        cfg.channelId +
        '".'
    );
  }

  return channelResult_(
    response.items[0],
    'public handle/id (scheduled/private usually hidden)'
  );
}

function channelResult_(ch, authPath) {
  var uploads =
    ch.contentDetails &&
    ch.contentDetails.relatedPlaylists &&
    ch.contentDetails.relatedPlaylists.uploads;

  if (!uploads) {
    throw new Error('Channel has no uploads playlist: ' + ch.id);
  }

  return {
    channelId: ch.id,
    uploadsPlaylistId: uploads,
    title: (ch.snippet && ch.snippet.title) || ch.id,
    customUrl: normalizeHandle_((ch.snippet && ch.snippet.customUrl) || ''),
    authPath: authPath
  };
}

function normalizeHandle_(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

/**
 * Debug helper: show channels visible to the signed-in YouTube identity.
 */
function listMyYouTubeChannels() {
  var lines = [];
  var pageToken = null;

  do {
    var opts = { mine: true, maxResults: 50 };
    if (pageToken) {
      opts.pageToken = pageToken;
    }
    var response = YouTube.Channels.list('snippet,contentDetails', opts);
    var items = response.items || [];
    for (var i = 0; i < items.length; i++) {
      var ch = items[i];
      var handle = (ch.snippet && ch.snippet.customUrl) || '(no handle)';
      var title = (ch.snippet && ch.snippet.title) || '';
      lines.push(title + ' | @' + handle + ' | ' + ch.id);
    }
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  var msg = lines.length
    ? 'Managed channels for this Google account:\n\n' + lines.join('\n')
    : 'No channels returned for mine:true.\n' +
      'This Google account is not an owner/manager in the YouTube API sense,\n' +
      'or you need to re-authorize after accepting YouTube permissions.';

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * List all video IDs from the channel uploads playlist.
 * @param {string} uploadsPlaylistId
 * @return {string[]}
 */
function listUploadVideoIds_(uploadsPlaylistId) {
  var ids = [];
  var pageToken = null;

  do {
    var opts = {
      playlistId: uploadsPlaylistId,
      maxResults: 50
    };
    if (pageToken) {
      opts.pageToken = pageToken;
    }

    var page = YouTube.PlaylistItems.list('contentDetails,status', opts);
    var items = page.items || [];
    for (var i = 0; i < items.length; i++) {
      var vid =
        items[i].contentDetails && items[i].contentDetails.videoId;
      if (vid) {
        ids.push(vid);
      }
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  return ids;
}

/**
 * Fetch video metadata in batches of 50.
 * @param {string[]} videoIds
 * @return {Array[]}
 */
function fetchVideoDetails_(videoIds) {
  var syncedAt = new Date();
  var rows = [];

  for (var i = 0; i < videoIds.length; i += 50) {
    var batch = videoIds.slice(i, i + 50);
    var resp = YouTube.Videos.list(
      'snippet,status,contentDetails,statistics',
      { id: batch.join(',') }
    );

    var items = resp.items || [];
    for (var j = 0; j < items.length; j++) {
      rows.push(normalizeVideo_(items[j], syncedAt));
    }
  }

  return rows;
}

/**
 * Map a YouTube Videos resource to a _youtube_raw row.
 * @param {Object} v
 * @param {Date} syncedAt
 * @return {Array}
 */
function normalizeVideo_(v, syncedAt) {
  var privacy = (v.status && v.status.privacyStatus) || '';
  var publishAt = (v.status && v.status.publishAt) || '';
  var publishedAt = (v.snippet && v.snippet.publishedAt) || '';
  // Scheduled uploads are private/unlisted with a future publishAt.
  var scheduled = !!publishAt && privacy !== 'public';

  var statusLabel = privacy || 'unknown';
  if (scheduled) {
    statusLabel = 'scheduled';
  } else if (privacy === 'public') {
    statusLabel = 'published';
  } else if (privacy === 'unlisted') {
    statusLabel = 'unlisted';
  } else if (privacy === 'private') {
    statusLabel = 'private';
  }

  var when = scheduled ? publishAt : publishedAt;
  var stats = v.statistics || {};
  var durationIso =
    (v.contentDetails && v.contentDetails.duration) || '';
  var title = (v.snippet && v.snippet.title) || '';
  var description = (v.snippet && v.snippet.description) || '';
  var format = videoFormatLabel_(title, description, durationIso);
  var url =
    format === 'short'
      ? 'https://www.youtube.com/shorts/' + v.id
      : 'https://www.youtube.com/watch?v=' + v.id;

  return [
    v.id,
    title,
    url,
    statusLabel,
    when ? new Date(when) : '',
    numOrBlank_(stats.viewCount),
    numOrBlank_(stats.likeCount),
    numOrBlank_(stats.commentCount),
    // Plain-language duration so Sheets does not coerce "5:32" into a time serial.
    iso8601DurationToHuman_(durationIso),
    format,
    privacy,
    '', // Subscribers gained — filled by Analytics when brand token has yt-analytics scope
    syncedAt
  ];
}

/**
 * short = classic Short (≤60s) or tagged #shorts; else regular.
 * YouTube Shorts can be up to 3 minutes; without aspect ratio we only
 * promote 61–180s when #shorts is present.
 * @param {string} title
 * @param {string} description
 * @param {string} durationIso
 * @return {string} 'short' | 'regular'
 */
function videoFormatLabel_(title, description, durationIso) {
  var text = String(title || '') + '\n' + String(description || '');
  if (/#shorts\b/i.test(text)) {
    return 'short';
  }
  var seconds = iso8601DurationToSeconds_(durationIso);
  if (seconds > 0 && seconds <= 60) {
    return 'short';
  }
  return 'regular';
}

/**
 * @param {string} iso
 * @return {number}
 */
function iso8601DurationToSeconds_(iso) {
  if (!iso) return 0;
  var m = String(iso).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (
    Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
  );
}

function numOrBlank_(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = Number(v);
  return isNaN(n) ? '' : n;
}

/**
 * Convert ISO-8601 duration (PT#H#M#S) to "5m 32s" / "1h 02m 03s".
 * Avoids Google Sheets treating "5:32" as a clock time (fraction of a day).
 * @param {string} iso
 * @return {string}
 */
function iso8601DurationToHuman_(iso) {
  if (!iso) return '';
  var m = String(iso).match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
  );
  if (!m) return iso;
  var h = Number(m[1] || 0);
  var min = Number(m[2] || 0);
  var s = Number(m[3] || 0);
  var parts = [];
  if (h > 0) parts.push(h + 'h');
  if (min > 0 || h > 0) parts.push(min + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

/**
 * Count status labels for the sync summary.
 * @param {Array[]} rows
 * @return {string}
 */
function summarizeStatuses_(rows) {
  var counts = {};
  for (var i = 0; i < rows.length; i++) {
    var s = String(rows[i][3] || 'unknown');
    counts[s] = (counts[s] || 0) + 1;
  }
  var keys = Object.keys(counts).sort();
  var parts = [];
  for (var k = 0; k < keys.length; k++) {
    parts.push(keys[k] + '=' + counts[keys[k]]);
  }
  return parts.join(', ') || 'none';
}

/**
 * Pull all videos for the configured channel.
 * Merges IDs from _extra_video_ids (scheduled/private Brand Account workaround).
 * @return {{channel: Object, rows: Array[], extraRequested: number, extraResolved: number}}
 */
function pullChannelVideos_() {
  var cfg = getSyncConfig_();
  var channel;
  var ids;
  var useBrand = hasBrandYouTubeAuth_();

  if (useBrand) {
    channel = resolveChannelBrandHttp_(cfg);
    ids = listUploadVideoIdsHttp_(channel.uploadsPlaylistId);
  } else {
    channel = resolveChannel_(cfg);
    ids = listUploadVideoIds_(channel.uploadsPlaylistId);
  }

  var extraIds = loadExtraVideoIds_();
  var bomOrphanIds = loadBomOrphanVideoIds_(ids, extraIds);
  var seen = {};
  for (var i = 0; i < ids.length; i++) {
    seen[ids[i]] = true;
  }
  var merged = ids.slice();
  for (var e = 0; e < extraIds.length; e++) {
    if (!seen[extraIds[e]]) {
      seen[extraIds[e]] = true;
      merged.push(extraIds[e]);
    }
  }
  // BOM rows whose IDs fell out of the uploads playlist (still on channel).
  for (var b = 0; b < bomOrphanIds.length; b++) {
    if (!seen[bomOrphanIds[b]]) {
      seen[bomOrphanIds[b]] = true;
      merged.push(bomOrphanIds[b]);
    }
  }

  var rows = useBrand
    ? fetchVideoDetailsHttp_(merged)
    : fetchVideoDetails_(merged);

  var subsFilled = 0;
  if (useBrand) {
    subsFilled = enrichRowsWithSubscribersGained_(channel.channelId, rows);
  }
  channel.subscribersGainedFilled = subsFilled;

  var resolvedExtra = 0;
  var resolvedBomOrphans = 0;
  for (var r = 0; r < rows.length; r++) {
    var rid = rows[r][0];
    if (extraIds.indexOf(rid) !== -1) {
      resolvedExtra++;
    }
    if (bomOrphanIds.indexOf(rid) !== -1) {
      resolvedBomOrphans++;
    }
  }

  rows.sort(function (a, b) {
    var da = a[4] ? new Date(a[4]).getTime() : 0;
    var db = b[4] ? new Date(b[4]).getTime() : 0;
    return db - da;
  });

  channel.extraRequested = extraIds.length;
  channel.extraResolved = resolvedExtra;
  channel.bomOrphansRequested = bomOrphanIds.length;
  channel.bomOrphansResolved = resolvedBomOrphans;

  return { channel: channel, rows: rows };
}

/**
 * BOM Video IDs that are not in the uploads playlist or _extra_video_ids.
 * Some channel videos (esp. older / unlisted) can fall out of uploads.
 * @param {string[]} uploadIds
 * @param {string[]} extraIds
 * @return {string[]}
 */
function loadBomOrphanVideoIds_(uploadIds, extraIds) {
  var known = {};
  for (var i = 0; i < uploadIds.length; i++) {
    known[uploadIds[i]] = true;
  }
  for (var e = 0; e < extraIds.length; e++) {
    known[extraIds[e]] = true;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bom = ss.getSheetByName(CONFIG.SHEETS.BOM);
  if (!bom) return [];

  var lastRow = bom.getLastRow();
  if (lastRow < 2) return [];

  var values = bom.getRange(2, 1, lastRow - 1, 1).getValues();
  var orphans = [];
  var seen = {};
  for (var r = 0; r < values.length; r++) {
    var id = String(values[r][0] || '').trim();
    if (!id || known[id] || seen[id]) continue;
    seen[id] = true;
    orphans.push(id);
  }
  return orphans;
}

/**
 * Video IDs / Studio URLs from the _extra_video_ids tab.
 * @return {string[]}
 */
function loadExtraVideoIds_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.EXTRA_IDS);
  if (!sheet) {
    return [];
  }
  var values = sheet.getDataRange().getValues();
  var ids = [];
  var seen = {};
  for (var i = 1; i < values.length; i++) {
    var id = extractVideoId_(String(values[i][0] || ''));
    if (id && !seen[id]) {
      seen[id] = true;
      ids.push(id);
    }
  }
  return ids;
}
